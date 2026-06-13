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
import { createSafety, GuardrailBlockedError } from '../../safety'
import { guardrail } from '../../safety/guardrail'
import { resetRuntime } from '../../runtime'
import type { Message } from '../../messages'

afterEach(() => {
  resetRuntime()
})

const identity = (options?: Partial<Parameters<typeof createSafety>[0]>) =>
  createSafety({ promptId: 'p1', model: 'm1', ...options })

const userMessage = (content: string): Message => ({ role: 'user', content })

// ── Declaration order + content threading ──────────────────────────

describe('guardInput — pipeline ordering and content flow', () => {
  it('runs input guards in declaration order, threading each guard output into the next', async () => {
    const seen: string[] = []
    const tagging = (name: string, suffix: string) =>
      guardrail({
        name,
        phase: 'input' as const,
        validate: async (content) => {
          seen.push(`${name}:${content}`)
          return { action: 'transform' as const, content: `${content}${suffix}` }
        },
      })

    const safety = identity({ call: { guardrails: [tagging('g1', '-1'), tagging('g2', '-2')] } })
    const result = await safety.guardInput({ messages: [userMessage('x')] })

    // g1 sees the raw content; g2 sees g1's transformed output.
    expect(seen).toEqual(['g1:x', 'g2:x-1'])
    // The final message carries both transforms, applied in order.
    expect(result.messages.at(-1)?.content).toBe('x-1-2')
  })

  it('feeds the redacted output of an earlier guard into a later guard as its input', async () => {
    const laterSaw = vi.fn()
    const redactor = guardrail({
      name: 'redactor',
      phase: 'input',
      validate: async (content) => ({ action: 'redact' as const, content: content.replace('secret', '[X]') }),
    })
    const inspector = guardrail({
      name: 'inspector',
      phase: 'input',
      validate: async (content) => {
        laterSaw(content)
        return { action: 'pass' as const }
      },
    })

    const safety = identity({ call: { guardrails: [redactor, inspector] } })
    await safety.guardInput({ messages: [userMessage('a secret value')] })

    expect(laterSaw).toHaveBeenCalledWith('a [X] value')
    // Both guards land in the audit, redactor first, keeping the pre-redaction original.
    const applied = safety.audit.guardrails?.applied ?? []
    expect(applied.map((entry) => entry.guard)).toEqual(['redactor', 'inspector'])
    expect(applied[0]).toMatchObject({ guard: 'redactor', action: 'redact', original: 'a secret value' })
  })
})

// ── Short-circuit on block ─────────────────────────────────────────

describe('guardInput — block short-circuit', () => {
  it('stops at the first blocking guard — a later guard never runs', async () => {
    const later = vi.fn()
    const blocker = guardrail({
      name: 'blocker',
      phase: 'input',
      validate: async () => ({ action: 'block' as const, reason: 'nope' }),
    })
    const after = guardrail({
      name: 'after',
      phase: 'input',
      validate: async () => {
        later()
        return { action: 'pass' as const }
      },
    })

    const safety = identity({ call: { guardrails: [blocker, after] } })

    await expect(safety.guardInput({ messages: [userMessage('hi')] })).rejects.toBeInstanceOf(GuardrailBlockedError)
    expect(later).not.toHaveBeenCalled()
  })

  it('throws a GuardrailBlockedError shaped with guardrailId, phase, and reason', async () => {
    const blocker = guardrail({
      name: 'pii',
      phase: 'input',
      validate: async () => ({ action: 'block' as const, reason: 'secret detected' }),
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
})
