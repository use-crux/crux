/**
 * Boundary tests for the per-call `Safety` session (`createSafety`).
 *
 * Everything here exercises the session through its public surface — fake
 * check functions, runtime globals, and a recording observability
 * transport. No internal pipeline/runner imports: those are implementation
 * details the session hides.
 */

import { afterEach, describe, it, expect, vi } from 'vitest'
import { createSafety, GuardrailBlockedError, ConstraintViolationError } from '../../safety'
import type { SafetyOutput } from '../../safety'
import { guardrail } from '../../safety/guardrail'
import { constraint } from '../../safety/constraint'
import { updateRuntime, resetRuntime } from '../../runtime/runtime'
import type { Message } from '../../generation/messages'

afterEach(() => {
  resetRuntime()
})

// ── Helpers ────────────────────────────────────────────────────────

const identity = (options?: Partial<Parameters<typeof createSafety>[0]>) =>
  createSafety({ promptId: 'p1', model: 'm1', ...options })

const passGuard = (name: string, phase: 'input' | 'output', spy?: ReturnType<typeof vi.fn>) =>
  guardrail({
    name,
    phase,
    validate: async (content) => {
      spy?.(content)
      return { action: 'pass' as const }
    },
  })

const passingConstraint = (name: string, spy?: ReturnType<typeof vi.fn>) =>
  constraint({
    name,
    check: async (output) => {
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

    updateRuntime({ globalGuardrails: [passGuard('global-g', 'output')] })
    expect(identity().enabled).toBe(true)
  })
})

// ── Three-scope precedence merge ───────────────────────────────────

describe('createSafety — scope precedence', () => {
  it('per-call beats per-prompt beats global for same-named guardrails', async () => {
    const globalSpy = vi.fn()
    const promptSpy = vi.fn()
    const callSpy = vi.fn()

    updateRuntime({ globalGuardrails: [passGuard('shared', 'input', globalSpy)] })
    const safety = identity({
      resolved: { guardrails: [passGuard('shared', 'input', promptSpy)] },
      call: { guardrails: [passGuard('shared', 'input', callSpy)] },
    })

    await safety.guardInput({ messages: [userMessage('hi')] })

    expect(callSpy).toHaveBeenCalledTimes(1)
    expect(promptSpy).not.toHaveBeenCalled()
    expect(globalSpy).not.toHaveBeenCalled()
  })

  it('differently named policies from all scopes all run', async () => {
    const spies = { a: vi.fn(), b: vi.fn(), c: vi.fn() }
    updateRuntime({ globalConstraints: [passingConstraint('a', spies.a)] })
    const safety = identity({
      resolved: { constraints: [passingConstraint('b', spies.b)] },
      call: { constraints: [passingConstraint('c', spies.c)] },
    })

    await safety.finalizeOutput({ text: 'fine' }, noRegen)

    expect(spies.a).toHaveBeenCalledTimes(1)
    expect(spies.b).toHaveBeenCalledTimes(1)
    expect(spies.c).toHaveBeenCalledTimes(1)
  })

  it('per-prompt constraint overrides same-named global constraint', async () => {
    const globalSpy = vi.fn()
    const promptSpy = vi.fn()
    updateRuntime({ globalConstraints: [passingConstraint('shared', globalSpy)] })
    const safety = identity({ resolved: { constraints: [passingConstraint('shared', promptSpy)] } })

    await safety.finalizeOutput({ text: 'fine' }, noRegen)

    expect(promptSpy).toHaveBeenCalledTimes(1)
    expect(globalSpy).not.toHaveBeenCalled()
  })
})

// ── guardInput ─────────────────────────────────────────────────────

describe('createSafety — guardInput', () => {
  it('throws GuardrailBlockedError when an input guard blocks', async () => {
    const blocker = guardrail({
      name: 'no-secrets',
      phase: 'input',
      validate: async () => ({ action: 'block' as const, reason: 'secret detected' }),
    })
    const safety = identity({ call: { guardrails: [blocker] } })

    await expect(safety.guardInput({ messages: [userMessage('my secret')] })).rejects.toBeInstanceOf(
      GuardrailBlockedError,
    )
  })

  it('writes redacted content back into the returned messages', async () => {
    const redactor = guardrail({
      name: 'pii',
      phase: 'input',
      validate: async (content) => ({ action: 'redact' as const, content: content.replace('123-45-6789', '[SSN]') }),
    })
    const safety = identity({ call: { guardrails: [redactor] } })

    const result = await safety.guardInput({
      messages: [userMessage('first'), { role: 'assistant', content: 'ok' }, userMessage('ssn is 123-45-6789')],
    })

    expect(result.messages.at(-1)?.content).toBe('ssn is [SSN]')
    // Earlier messages untouched.
    expect(result.messages[0]?.content).toBe('first')
    // Audit keeps the original.
    expect(safety.audit.guardrails?.applied[0]).toMatchObject({
      guard: 'pii',
      phase: 'input',
      action: 'redact',
      original: 'ssn is 123-45-6789',
    })
  })

  it('falls back to prompt text when history has no user message', async () => {
    const redactor = guardrail({
      name: 'pii',
      phase: 'input',
      validate: async () => ({ action: 'redact' as const, content: 'clean prompt' }),
    })
    const safety = identity({ call: { guardrails: [redactor] } })

    const result = await safety.guardInput({ messages: [], prompt: 'dirty prompt' })

    expect(result.prompt).toBe('clean prompt')
    expect(result.messages).toEqual([])
  })

  it('only runs input-phase guards', async () => {
    const inputSpy = vi.fn()
    const outputSpy = vi.fn()
    const safety = identity({
      call: { guardrails: [passGuard('in', 'input', inputSpy), passGuard('out', 'output', outputSpy)] },
    })

    await safety.guardInput({ messages: [userMessage('hi')] })

    expect(inputSpy).toHaveBeenCalledTimes(1)
    expect(outputSpy).not.toHaveBeenCalled()
  })

  it('records an input.guard transcript event with applied actions', async () => {
    const safety = identity({ call: { guardrails: [passGuard('in', 'input')] } })
    await safety.guardInput({ messages: [userMessage('hi')] })

    expect(safety.transcript).toContainEqual({ t: 'input.guard', guards: 1, actions: ['pass'] })
  })
})
