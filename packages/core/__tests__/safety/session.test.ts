/**
 * Boundary tests for the per-call `Safety` session (`createSafety`).
 *
 * Everything here exercises the session through its public surface — fake
 * check functions, runtime globals, and a recording observability
 * transport. No internal pipeline/runner imports: those are implementation
 * details the session hides.
 */

import { afterEach, describe, it, expect, vi } from 'vitest'
import { boundary, createSafety, GuardrailBlockedError, ConstraintViolationError } from '../../src/safety'
import type { SafetyOutput } from '../../src/safety'
import { guardrail } from '../../src/safety/guardrail'
import { constraint } from '../../src/safety/constraint'
import { updateHooks, resetHooks } from '../../src/runtime/runtime'
import type { Message } from '../../src/generation/messages'

afterEach(() => {
  resetHooks()
})

// ── Helpers ────────────────────────────────────────────────────────

const identity = (options?: Partial<Parameters<typeof createSafety>[0]>) =>
  createSafety({ promptId: 'p1', model: 'm1', ...options })

const passGuard = (id: string, target: 'input' | 'output', spy?: ReturnType<typeof vi.fn>) =>
  guardrail({
    id,
    on: target === 'input' ? boundary.input.text() : boundary.output.text(),
    run: async (content) => {
      spy?.(content)
      return { action: 'allow' as const }
    },
  })

const passingConstraint = (id: string, spy?: ReturnType<typeof vi.fn>) =>
  constraint({
    id,
    on: boundary.output.both(),
    run: async (output) => {
      spy?.(output)
      return { pass: true as const }
    },
  })

const userMessage = (content: string): Message => ({ role: 'user', content })

const noRegen = async (): Promise<SafetyOutput> => {
  throw new Error('regenerate must not be called')
}

// ── enabled ────────────────────────────────────────────────────────

describe('createSafety — enabled', () => {
  it('is disabled when nothing applies, and methods are passthroughs', async () => {
    const safety = identity()
    expect(safety.enabled).toBe(false)

    const input = { messages: [userMessage('hello')] }
    expect(await safety.guardInput(input)).toEqual(input)

    const output = { text: 'result' }
    expect(await safety.finalizeOutput(output, noRegen)).toEqual(output)

    const meta = { finishReason: 'stop' }
    expect(safety.stamp(meta)).toEqual(meta)
    expect(safety.transcript).toEqual([])
  })

  it('is enabled when a guardrail or constraint applies from any scope', () => {
    expect(identity({ call: { guardrails: [passGuard('g', 'input')] } }).enabled).toBe(true)
    expect(identity({ resolved: { constraints: [passingConstraint('c')] } }).enabled).toBe(true)

    updateHooks({ globalGuardrails: [passGuard('global-g', 'output')] })
    expect(identity().enabled).toBe(true)
  })
})

// ── Policy identity ────────────────────────────────────────────────

describe('createSafety — policy identity', () => {
  it('rejects duplicate guardrail ids across scopes and targets instead of silently overriding', () => {
    const globalSpy = vi.fn()
    const callSpy = vi.fn()

    updateHooks({ globalGuardrails: [passGuard('shared', 'input', globalSpy)] })
    expect(() =>
      identity({
        call: { guardrails: [passGuard('shared', 'output', callSpy)] },
      }),
    ).toThrow(/duplicate|shared/i)
    expect(globalSpy).not.toHaveBeenCalled()
    expect(callSpy).not.toHaveBeenCalled()
  })

  it('differently named policies from all scopes all run', async () => {
    const spies = { a: vi.fn(), b: vi.fn(), c: vi.fn() }
    updateHooks({ globalConstraints: [passingConstraint('a', spies.a)] })
    const safety = identity({
      resolved: { constraints: [passingConstraint('b', spies.b)] },
      call: { constraints: [passingConstraint('c', spies.c)] },
    })

    await safety.finalizeOutput({ text: 'fine' }, noRegen)

    expect(spies.a).toHaveBeenCalledTimes(1)
    expect(spies.b).toHaveBeenCalledTimes(1)
    expect(spies.c).toHaveBeenCalledTimes(1)
  })

  it('rejects duplicate constraint ids instead of applying scope precedence', () => {
    const globalSpy = vi.fn()
    const promptSpy = vi.fn()
    updateHooks({ globalConstraints: [passingConstraint('shared', globalSpy)] })

    expect(() =>
      identity({
        resolved: { constraints: [passingConstraint('shared', promptSpy)] },
      }),
    ).toThrow(/duplicate|shared/i)
    expect(promptSpy).not.toHaveBeenCalled()
    expect(globalSpy).not.toHaveBeenCalled()
  })
})

// ── safety.tune ───────────────────────────────────────────────────

describe('createSafety — safety.tune', () => {
  it('rejects tune entries for unknown policy ids', () => {
    expect(() =>
      identity({
        call: { guardrails: [passGuard('known', 'input')] },
        safety: { tune: { missing: { enabled: false } } },
      }),
    ).toThrow(/unknown|missing/i)
  })

  it('audits enabled:false and skips the disabled guardrail', async () => {
    const blocker = guardrail({
      id: 'disable-me',
      on: boundary.input.text(),
      run: async () => ({ action: 'block' as const, reason: 'would block' }),
    })
    const safety = identity({
      call: { guardrails: [blocker] },
      safety: { tune: { 'disable-me': { enabled: false } } },
    })

    const result = await safety.guardInput({ messages: [userMessage('leave unchanged')] })

    expect(result.messages).toEqual([userMessage('leave unchanged')])
    expect(safety.audit.guardrails?.applied).toContainEqual(
      expect.objectContaining({
        guard: 'disable-me',
        action: 'allow',
        reason: 'disabled by call site',
      }),
    )
  })
})

// ── guardInput ─────────────────────────────────────────────────────

describe('createSafety — guardInput', () => {
  it('throws GuardrailBlockedError when an input guard blocks', async () => {
    const blocker = guardrail({
      id: 'no-secrets',
      on: boundary.input.text(),
      run: async () => ({
        action: 'block' as const,
        reason: 'secret detected',
      }),
    })
    const safety = identity({ call: { guardrails: [blocker] } })

    await expect(safety.guardInput({ messages: [userMessage('my secret')] })).rejects.toBeInstanceOf(
      GuardrailBlockedError,
    )
  })

  it('retains only privacy-safe user provenance in blocked input decisions', async () => {
    const blocker = guardrail({
      id: 'origin-aware-block',
      on: boundary.input.text(),
      run: async () => ({ action: 'block' as const, reason: 'blocked' }),
    })
    const safety = identity({ call: { guardrails: [blocker] } })

    const error = await safety
      .guardInput({ messages: [userMessage('SECRET_INPUT')] })
      .then(() => undefined)
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(GuardrailBlockedError)
    expect((error as GuardrailBlockedError).decisions[0]?.origin).toEqual({
      source: 'user',
      kind: 'message',
      messageIndex: 0,
    })
    expect(JSON.stringify({ error, audit: safety.audit })).not.toContain('SECRET_INPUT')
  })

  it('writes redacted content back into the returned messages', async () => {
    const redactor = guardrail({
      id: 'pii',
      on: boundary.input.text(),
      run: async (content) => ({
        action: 'rewrite' as const,
        value: content.replace('123-45-6789', '[SSN]'),
        rewrite: { kind: 'redact' as const },
      }),
    })
    const safety = identity({ call: { guardrails: [redactor] } })

    const result = await safety.guardInput({
      messages: [userMessage('first'), { role: 'assistant', content: 'ok' }, userMessage('ssn is 123-45-6789')],
    })

    expect(result.messages.at(-1)?.content).toBe('ssn is [SSN]')
    // Earlier messages untouched.
    expect(result.messages[0]?.content).toBe('first')
    // Safe-by-default audit must not expose the raw pre-redaction input.
    const rewriteAudit = safety.audit.guardrails?.applied.find(
      (entry) => entry.origin?.source === 'user' && entry.origin.messageIndex === 2,
    )
    expect(rewriteAudit).toMatchObject({
      guard: 'pii',
      phase: 'input',
      action: 'redact',
      origin: { source: 'user', kind: 'message', messageIndex: 2 },
    })
    expect(rewriteAudit).not.toHaveProperty('original')
  })

  it('falls back to prompt text when history has no user message', async () => {
    const redactor = guardrail({
      id: 'pii',
      on: boundary.input.text(),
      run: async () => ({
        action: 'rewrite' as const,
        value: 'clean prompt',
        rewrite: { kind: 'redact' as const },
      }),
    })
    const safety = identity({ call: { guardrails: [redactor] } })

    const result = await safety.guardInput({
      messages: [],
      prompt: 'dirty prompt',
    })

    expect(result.prompt).toBe('clean prompt')
    expect(result.messages).toEqual([])
  })

  it('only runs input-phase guards', async () => {
    const inputSpy = vi.fn()
    const outputSpy = vi.fn()
    const safety = identity({
      call: {
        guardrails: [passGuard('in', 'input', inputSpy), passGuard('out', 'output', outputSpy)],
      },
    })

    await safety.guardInput({ messages: [userMessage('hi')] })

    expect(inputSpy).toHaveBeenCalledTimes(1)
    expect(outputSpy).not.toHaveBeenCalled()
  })

  it('records an input.guard transcript event with applied actions', async () => {
    const safety = identity({
      call: { guardrails: [passGuard('in', 'input')] },
    })
    await safety.guardInput({ messages: [userMessage('hi')] })

    expect(safety.transcript).toContainEqual({
      t: 'input.guard',
      guards: 1,
      actions: ['allow'],
    })
  })
})
