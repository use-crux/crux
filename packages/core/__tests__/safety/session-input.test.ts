/**
 * Boundary tests for the `Safety` session input phase: the guardrail
 * *pipeline* behaviors (`safety/guardrail/pipeline.ts`) as observed through
 * `createSafety().guardInput(...)`.
 *
 * These pin behaviors the neighboring `session.test.ts` leaves uncovered:
 * declaration-order execution, redact/transform content threading forward to
 * the next guard, first-`block` short-circuit, and the shape of the thrown
 * `GuardrailBlockedError`. The pipeline is never imported directly — it sits
 * behind the session boundary on purpose.
 */

import { afterEach, describe, it, expect, vi } from 'vitest'
import { boundary, createSafety, GuardrailBlockedError } from '../../src/safety'
import { guardrail } from '../../src/safety/guardrail'
import { resetHooks } from '../../src/runtime/runtime'
import type { Message } from '../../src/generation/messages'
import { messageText, textPart } from '../../src/content'

afterEach(() => {
  resetHooks()
})

const identity = (options?: Partial<Parameters<typeof createSafety>[0]>) =>
  createSafety({ promptId: 'p1', model: 'm1', ...options })

const userMessage = (content: string): Message => ({ role: 'user', content })

// ── Declaration order + content threading ──────────────────────────

describe('guardInput — pipeline ordering and content flow', () => {
  it('runs input guards in declaration order, threading each guard output into the next', async () => {
    const seen: string[] = []
    const tagging = (id: string, suffix: string) =>
      guardrail({
        id,
        on: boundary.input.text(),
        run: async (content) => {
          seen.push(`${id}:${content}`)
          return {
            action: 'rewrite' as const,
            value: `${content}${suffix}`,
            rewrite: { kind: 'normalize' as const },
          }
        },
      })

    const safety = identity({
      call: { guardrails: [tagging('g1', '-1'), tagging('g2', '-2')] },
    })
    const result = await safety.guardInput({ messages: [userMessage('x')] })

    // g1 sees the raw content; g2 sees g1's transformed output.
    expect(seen).toEqual(['g1:x', 'g2:x-1'])
    // The final message carries both transforms, applied in order.
    expect(result.messages.at(-1)?.content).toBe('x-1-2')
  })

  it('feeds the redacted output of an earlier guard into a later guard as its input', async () => {
    const laterSaw = vi.fn()
    const redactor = guardrail({
      id: 'redactor',
      on: boundary.input.text(),
      run: async (content) => ({
        action: 'rewrite' as const,
        value: content.replace('secret', '[X]'),
        rewrite: { kind: 'redact' as const },
      }),
    })
    const inspector = guardrail({
      id: 'inspector',
      on: boundary.input.text(),
      run: async (content) => {
        laterSaw(content)
        return { action: 'allow' as const }
      },
    })

    const safety = identity({ call: { guardrails: [redactor, inspector] } })
    await safety.guardInput({ messages: [userMessage('a secret value')] })

    expect(laterSaw).toHaveBeenCalledWith('a [X] value')
    // Both guards land in the audit, redactor first, without leaking the raw pre-redaction input.
    const applied = safety.audit.guardrails?.applied ?? []
    expect(applied.map((entry) => entry.guard)).toEqual(['redactor', 'inspector'])
    expect(applied[0]).toMatchObject({ guard: 'redactor', action: 'redact' })
    expect(applied[0]).not.toHaveProperty('original')
  })

  it('guards every user message instead of only the last user turn', async () => {
    const seen: string[] = []
    const redactor = guardrail({
      id: 'all-user-input',
      on: boundary.input.text(),
      run: async (content) => {
        seen.push(content)
        return {
          action: 'rewrite' as const,
          value: content.replaceAll('secret', '[X]'),
          rewrite: { kind: 'redact' as const },
        }
      },
    })
    const safety = identity({ call: { guardrails: [redactor] } })

    const result = await safety.guardInput({
      messages: [userMessage('first secret'), { role: 'assistant', content: 'ok' }, userMessage('second secret')],
    })

    expect(seen).toEqual(['first secret', 'second secret'])
    expect(result.messages.map((message) => message.content)).toEqual(['first [X]', 'ok', 'second [X]'])
  })

  it('validates the text projection of multimodal user messages', async () => {
    const seen = vi.fn()
    const inspector = guardrail({
      id: 'multimodal-input',
      on: boundary.input.text(),
      run: async (content) => {
        seen(content)
        return { action: 'allow' as const }
      },
    })
    const safety = identity({ call: { guardrails: [inspector] } })
    const content = [
      textPart('review this chart'),
      { type: 'image', source: new Uint8Array([1, 2, 3]), mediaType: 'image/png' },
    ]

    await safety.guardInput({ messages: [{ role: 'user', content }] })

    expect(seen).toHaveBeenCalledWith(messageText({ content }))
    expect(seen.mock.calls[0]?.[0]).toContain('[image image/png 3B sha256:')
    expect(seen.mock.calls[0]?.[0]).not.toContain('AQID')
  })

  it('rewrites text parts while leaving media parts untouched', async () => {
    const redactor = guardrail({
      id: 'redact-text',
      on: boundary.input.text(),
      run: async (content) => ({
        action: 'rewrite' as const,
        value: content.replace('secret', '[X]'),
        rewrite: { kind: 'redact' as const },
      }),
    })
    const safety = identity({ call: { guardrails: [redactor] } })
    const image = { type: 'image', source: new Uint8Array([1, 2, 3]), mediaType: 'image/png' }

    const result = await safety.guardInput({
      messages: [{ role: 'user', content: [textPart('secret caption'), image] }],
    })

    expect(result.messages[0]?.content).toEqual([textPart('[X] caption'), image])
    expect(messageText(result.messages[0]!)).toMatch(/^\[X\] caption\n\[image image\/png 3B sha256:[a-f0-9]{12}\]$/)
  })
})

// ── Short-circuit on block ─────────────────────────────────────────

describe('guardInput — block short-circuit', () => {
  it('stops at the first blocking guard — a later guard never runs', async () => {
    const later = vi.fn()
    const blocker = guardrail({
      id: 'blocker',
      on: boundary.input.text(),
      run: async () => ({ action: 'block' as const, reason: 'nope' }),
    })
    const after = guardrail({
      id: 'after',
      on: boundary.input.text(),
      run: async () => {
        later()
        return { action: 'allow' as const }
      },
    })

    const safety = identity({ call: { guardrails: [blocker, after] } })

    await expect(safety.guardInput({ messages: [userMessage('hi')] })).rejects.toBeInstanceOf(GuardrailBlockedError)
    expect(later).not.toHaveBeenCalled()
  })

  it('throws a GuardrailBlockedError shaped with guardrailId, phase, and reason', async () => {
    const blocker = guardrail({
      id: 'pii',
      on: boundary.input.text(),
      run: async () => ({
        action: 'block' as const,
        reason: 'secret detected',
      }),
    })
    const safety = identity({ call: { guardrails: [blocker] } })

    const error = await safety
      .guardInput({ messages: [userMessage('x')] })
      .then(() => undefined)
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(GuardrailBlockedError)
    const blocked = error as GuardrailBlockedError
    expect(blocked.guardrailId).toBe('pii')
    expect(blocked.phase).toBe('input')
    expect(blocked.reason).toBe('secret detected')
  })

  it('attaches safe terminal decision metadata to a blocking error', async () => {
    const blocker = guardrail({
      id: 'pii',
      on: boundary.input.text(),
      run: async () => ({
        action: 'block' as const,
        reason: 'secret detected',
      }),
    })
    const safety = identity({ call: { guardrails: [blocker] } })

    const error = await safety
      .guardInput({ messages: [userMessage('my ssn is 123-45-6789')] })
      .then(() => undefined)
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(GuardrailBlockedError)
    const terminal = error as {
      readonly decisions?: readonly Record<string, unknown>[]
      readonly audit?: {
        readonly applied?: readonly Record<string, unknown>[]
      }
    }
    const decisions = terminal.decisions ?? terminal.audit?.applied ?? []
    expect(decisions).toContainEqual(
      expect.objectContaining({
        action: 'block',
        reason: 'secret detected',
      }),
    )
    expect(JSON.stringify(decisions)).not.toContain('123-45-6789')
  })

  it('fails closed when a guardrail returns a malformed result', async () => {
    const malformed = guardrail({
      id: 'malformed',
      on: boundary.input.text(),
      run: async () => ({ action: 'rewrite' }) as never,
    })
    const safety = identity({ call: { guardrails: [malformed] } })

    await expect(safety.guardInput({ messages: [userMessage('secret')] })).rejects.toThrow(
      /invalid|malformed|safety|result/i,
    )
  })
})
