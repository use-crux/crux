/**
 * Boundary tests for the `Safety` session output phase: `finalizeOutput`
 * (constraint retry machine + output guards + suspension policy),
 * corrective-feedback formatting, instrumentation hooks, audit
 * accumulation, and `stamp()`.
 */

import { afterEach, describe, it, expect, vi } from 'vitest'
import { createSafety, ConstraintViolationError, GuardrailBlockedError, createSafetyPlugin } from '../../safety'
import type { SafetyCallOptions, SafetyOutput } from '../../safety'
import { guardrail } from '../../safety/guardrail'
import { constraint } from '../../safety/constraint'
import { updateRuntime, resetRuntime, getRuntime } from '../../runtime/runtime'
import { applyPlugins } from '../../runtime/plugin'
import type { Message } from '../../generation/messages'

afterEach(() => {
  resetRuntime()
})

const session = (options?: Partial<SafetyCallOptions>) =>
  createSafety({ promptId: 'p1', model: 'm1', traceId: 'trace-1', ...options })

const noRegen = async (): Promise<SafetyOutput> => {
  throw new Error('regenerate must not be called')
}

/** A constraint that fails until the output text contains `needle`. */
const needsNeedle = (name: string, needle: string, opts?: { severity?: 'assert' | 'suggest'; maxRetries?: number }) =>
  constraint({
    name,
    severity: opts?.severity,
    maxRetries: opts?.maxRetries,
    check: async (output) =>
      output.text.includes(needle)
        ? { pass: true as const }
        : { pass: false as const, feedback: `must mention ${needle}` },
  })

// ── finalizeOutput: constraint retry machine ──────────────────────

describe('finalizeOutput — constraints', () => {
  it('calls regenerate with the default-formatted corrective message and accepts the fixed output', async () => {
    const safety = session({
      call: { constraints: [needsNeedle('mentions-ship', 'ship')] },
    })
    const regenerate = vi.fn(async (): Promise<SafetyOutput> => ({ text: 'a ship appears' }))

    const final = await safety.finalizeOutput({ text: 'no boats here' }, regenerate)

    expect(final.text).toBe('a ship appears')
    expect(regenerate).toHaveBeenCalledTimes(1)
    const corrective = regenerate.mock.calls[0]![0] as readonly Message[]
    expect(corrective).toHaveLength(1)
    expect(corrective[0]).toEqual({
      role: 'user',
      content: [
        'Your previous output did not satisfy the following quality constraints. Please fix all issues in your next response.',
        '',
        '[mentions-ship]: must mention ship',
      ].join('\n'),
    })
  })

  it('throws ConstraintViolationError with audit attached when assert retries are exhausted', async () => {
    const safety = session({
      call: {
        constraints: [needsNeedle('strict', 'unicorn', { maxRetries: 1 })],
      },
    })
    const regenerate = vi.fn(async (): Promise<SafetyOutput> => ({ text: 'still wrong' }))

    const error = await safety
      .finalizeOutput({ text: 'wrong' }, regenerate)
      .then(() => undefined)
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ConstraintViolationError)
    const violation = error as ConstraintViolationError
    expect(violation.failedConstraints).toEqual([{ name: 'strict', feedback: 'must mention unicorn' }])
    expect(violation.audit.entries.length).toBeGreaterThan(0)
    expect(regenerate).toHaveBeenCalledTimes(1)
  })

  it('keeps raw failed output out of exhausted constraint errors by default', async () => {
    const safety = session({
      call: {
        constraints: [
          constraint({
            name: 'no-secret',
            maxRetries: 0,
            check: async () => ({
              pass: false as const,
              feedback: 'raw secret output rejected',
            }),
          }),
        ],
      },
    })

    const error = await safety
      .finalizeOutput({ text: 'secret email a@b.c' }, noRegen)
      .then(() => undefined)
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ConstraintViolationError)
    const violation = error as ConstraintViolationError & {
      readonly lastOutput?: unknown
      readonly decisions?: readonly unknown[]
    }
    expect(violation.lastOutput).toMatchObject({
      hash: expect.any(String),
    })
    expect(JSON.stringify(violation)).not.toContain('a@b.c')
  })

  it('enforces the shared constraintMaxRetries cap across constraints', async () => {
    const safety = session({
      call: {
        constraints: [needsNeedle('never-happy', 'unicorn', { maxRetries: 10 })],
        constraintMaxRetries: 2,
      },
    })
    const regenerate = vi.fn(async (): Promise<SafetyOutput> => ({ text: 'nope' }))

    await expect(safety.finalizeOutput({ text: 'nope' }, regenerate)).rejects.toBeInstanceOf(ConstraintViolationError)
    expect(regenerate).toHaveBeenCalledTimes(2)
  })

  it('suggest failures never regenerate and surface as suggestFallback in the audit', async () => {
    const safety = session({
      call: {
        constraints: [needsNeedle('soft', 'unicorn', { severity: 'suggest' })],
      },
    })

    const final = await safety.finalizeOutput({ text: 'plain output' }, noRegen)

    expect(final.text).toBe('plain output')
    expect(safety.audit.constraints?.suggestFallback).toBe(true)
    expect(safety.audit.constraints?.allPassed).toBe(false)
  })

  it('a custom formatter receives structured failures and call identity', async () => {
    const format = vi.fn(() => 'FIX IT')
    const safety = session({
      call: { constraints: [needsNeedle('brand-voice', 'ship')] },
      formatter: { format },
    })
    const regenerate = vi.fn(async (): Promise<SafetyOutput> => ({ text: 'ship shape' }))

    await safety.finalizeOutput({ text: 'wrong' }, regenerate)

    expect(format).toHaveBeenCalledWith(
      [
        {
          name: 'brand-voice',
          category: undefined,
          severity: 'assert',
          feedback: 'must mention ship',
        },
      ],
      expect.objectContaining({
        promptId: 'p1',
        model: 'm1',
        traceId: 'trace-1',
      }),
    )
    expect(regenerate.mock.calls[0]![0]).toEqual([{ role: 'user', content: 'FIX IT' }])
  })

  it('a formatter may return full messages, forwarded to regenerate as-is', async () => {
    const corrective: Message[] = [
      { role: 'assistant', content: 'I will fix this.' },
      { role: 'user', content: 'do better' },
    ]
    const safety = session({
      call: { constraints: [needsNeedle('c', 'ship')] },
      formatter: { format: () => corrective },
    })
    const regenerate = vi.fn(async (): Promise<SafetyOutput> => ({ text: 'ship' }))

    await safety.finalizeOutput({ text: 'wrong' }, regenerate)

    expect(regenerate.mock.calls[0]![0]).toBe(corrective)
  })
})

// ── finalizeOutput: output guards ─────────────────────────────────

describe('finalizeOutput — output guardrails', () => {
  it('redacts the final text via output guards after constraints pass', async () => {
    const redactor = guardrail({
      name: 'no-emails',
      phase: 'output',
      validate: async (content) => ({
        action: 'redact' as const,
        content: content.replace('a@b.c', '[EMAIL]'),
      }),
    })
    const safety = session({
      call: {
        constraints: [needsNeedle('has-contact', 'contact')],
        guardrails: [redactor],
      },
    })

    const final = await safety.finalizeOutput({ text: 'contact: a@b.c' }, noRegen)

    expect(final.text).toBe('contact: [EMAIL]')
    expect(safety.audit.constraints?.allPassed).toBe(true)
    expect(safety.audit.guardrails?.applied).toContainEqual(
      expect.objectContaining({ guard: 'no-emails', action: 'redact' }),
    )
  })

  it('throws GuardrailBlockedError with safe decision metadata when an output guard blocks', async () => {
    const blocker = guardrail({
      name: 'toxicity',
      phase: 'output',
      validate: async () => ({ action: 'block' as const, reason: 'toxic' }),
    })
    const safety = session({ call: { guardrails: [blocker] } })

    const error = await safety
      .finalizeOutput({ text: 'bad output' }, noRegen)
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
    expect(decisions).toContainEqual(expect.objectContaining({ action: 'block', reason: 'toxic' }))
    expect(JSON.stringify(decisions)).not.toContain('bad output')
  })

  it('resynchronizes the parsed object when a structured text guard rewrites JSON', async () => {
    const transformer = guardrail({
      name: 'email-redactor',
      phase: 'output',
      validate: async (content) => ({
        action: 'transform' as const,
        content: content.replace('a@b.c', '[EMAIL]'),
      }),
    })
    const safety = session({ call: { guardrails: [transformer] } })

    const final = await safety.finalizeOutput({ text: '{"email":"a@b.c"}', parsed: { email: 'a@b.c' } }, noRegen)

    expect(final.text).toBe('{"email":"[EMAIL]"}')
    expect(final.parsed).toEqual({ email: '[EMAIL]' })
  })

  it('runs output guardrails before constraints so constraints see guarded content', async () => {
    const seenByConstraint: string[] = []
    const redactor = guardrail({
      name: 'pii',
      phase: 'output',
      validate: async (content) => ({
        action: 'redact' as const,
        content: content.replace('a@b.c', '[EMAIL]'),
      }),
    })
    const noRawEmail = constraint({
      name: 'judge-safe',
      check: async (output) => {
        seenByConstraint.push(output.text)
        return { pass: true as const }
      },
    })
    const safety = session({
      call: { guardrails: [redactor], constraints: [noRawEmail] },
    })

    const final = await safety.finalizeOutput({ text: 'contact a@b.c' }, noRegen)

    expect(final.text).toBe('contact [EMAIL]')
    expect(seenByConstraint).toEqual(['contact [EMAIL]'])
  })

  it('fails closed when an output guardrail returns an unknown action', async () => {
    const malformed = guardrail({
      name: 'unknown-action',
      phase: 'output',
      validate: async () => ({ action: 'approve' }) as never,
    })
    const safety = session({ call: { guardrails: [malformed] } })

    await expect(safety.finalizeOutput({ text: 'unsafe' }, noRegen)).rejects.toThrow(/invalid|malformed|safety|result/i)
  })
})

// ── Runtime result validation ─────────────────────────────────────

describe('finalizeOutput — malformed constraint results', () => {
  it('fails closed when a constraint returns a non-boolean pass field', async () => {
    const malformed = constraint({
      name: 'malformed',
      check: async () => ({ pass: 'maybe' }) as never,
    })
    const safety = session({ call: { constraints: [malformed] } })

    await expect(safety.finalizeOutput({ text: 'unsafe' }, noRegen)).rejects.toThrow(/invalid|malformed|safety|result/i)
  })
})

// ── Suspension policy ──────────────────────────────────────────────

describe('finalizeOutput — suspension', () => {
  it('skips constraints and output guards when suspended, and records it in the transcript', async () => {
    const checkSpy = vi.fn()
    const guardSpy = vi.fn()
    const safety = session({
      call: {
        constraints: [
          constraint({
            name: 'c',
            check: async () => {
              checkSpy()
              return { pass: true as const }
            },
          }),
        ],
        guardrails: [
          guardrail({
            name: 'g',
            phase: 'output',
            validate: async (content) => {
              guardSpy()
              return { action: 'pass' as const, content } as never
            },
          }),
        ],
      },
    })

    const output = { text: 'asked for tool approval' }
    const final = await safety.finalizeOutput(output, noRegen, {
      suspended: true,
    })

    expect(final).toEqual(output)
    expect(checkSpy).not.toHaveBeenCalled()
    expect(guardSpy).not.toHaveBeenCalled()
    expect(safety.transcript).toContainEqual({ t: 'suspend' })
    expect(safety.audit.constraints).toBeUndefined()
    expect(safety.audit.guardrails).toBeUndefined()
  })
})
// ── stamp ──────────────────────────────────────────────────────────

describe('stamp', () => {
  it('attaches audits iff non-empty and preserves other meta fields', async () => {
    const safety = session({
      call: {
        guardrails: [
          guardrail({
            name: 'g',
            phase: 'input',
            validate: async () => ({ action: 'pass' as const }),
          }),
        ],
        constraints: [needsNeedle('c', 'fine')],
      },
    })
    await safety.guardInput({ messages: [{ role: 'user', content: 'hi' }] })
    await safety.finalizeOutput({ text: 'fine' }, noRegen)

    const meta = safety.stamp({
      finishReason: 'stop',
      usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
    })

    expect(meta.finishReason).toBe('stop')
    expect(meta.guardrails?.applied).toHaveLength(1)
    expect(meta.constraints?.entries).toHaveLength(1)
  })

  it('attaches nothing when no safety ran', () => {
    const safety = session({ call: { constraints: [needsNeedle('c', 'x')] } })
    const meta = safety.stamp({ finishReason: 'stop' })
    expect('guardrails' in meta).toBe(false)
    expect('constraints' in meta).toBe(false)
  })
})

// ── Category pass-through ──────────────────────────────────────────

describe('category metadata', () => {
  it('carries guardrail and constraint categories into audit entries', async () => {
    const safety = session({
      call: {
        guardrails: [
          guardrail({
            name: 'pii-scan',
            category: 'pii',
            phase: 'input',
            validate: async () => ({ action: 'pass' as const }),
          }),
        ],
        constraints: [
          constraint({
            name: 'grounded',
            category: 'grounding',
            check: async () => ({ pass: true as const }),
          }),
        ],
      },
    })
    await safety.guardInput({ messages: [{ role: 'user', content: 'hi' }] })
    await safety.finalizeOutput({ text: 'ok' }, noRegen)

    expect(safety.audit.guardrails?.applied[0]).toMatchObject({
      guard: 'pii-scan',
      category: 'pii',
    })
    expect(safety.audit.constraints?.entries[0]).toMatchObject({
      constraint: 'grounded',
      category: 'grounding',
    })
  })
})

// ── createSafetyPlugin + runtime registration ──────────────────────

describe('createSafetyPlugin', () => {
  it('registers global guardrails and constraints that reach the session via the runtime', async () => {
    const guardSpy = vi.fn()
    const checkSpy = vi.fn()
    const plugin = createSafetyPlugin({
      guardrails: [
        guardrail({
          name: 'global-guard',
          phase: 'input',
          validate: async () => {
            guardSpy()
            return { action: 'pass' as const }
          },
        }),
      ],
      constraints: [
        constraint({
          name: 'global-constraint',
          check: async () => {
            checkSpy()
            return { pass: true as const }
          },
        }),
      ],
    })

    const { runtime } = applyPlugins([plugin], getRuntime())
    updateRuntime(runtime)

    const safety = session()
    expect(safety.enabled).toBe(true)
    await safety.guardInput({ messages: [{ role: 'user', content: 'hi' }] })
    await safety.finalizeOutput({ text: 'out' }, noRegen)

    expect(guardSpy).toHaveBeenCalledTimes(1)
    expect(checkSpy).toHaveBeenCalledTimes(1)
  })

  it('multiple safety plugins compose — policies concatenate', () => {
    const g1 = guardrail({
      name: 'g1',
      phase: 'input',
      validate: async () => ({ action: 'pass' as const }),
    })
    const g2 = guardrail({
      name: 'g2',
      phase: 'input',
      validate: async () => ({ action: 'pass' as const }),
    })

    const { runtime } = applyPlugins(
      [createSafetyPlugin({ guardrails: [g1] }), createSafetyPlugin({ guardrails: [g2] })],
      getRuntime(),
    )

    expect(runtime.globalGuardrails?.map((g) => g.name)).toEqual(['g1', 'g2'])
  })
})

// ── Output-phase guardrail pipeline (ordering / flow / short-circuit) ─

describe('finalizeOutput — output guardrail pipeline', () => {
  it('runs output guards in declaration order, threading each guard output into the next', async () => {
    const seen: string[] = []
    const tagging = (name: string, suffix: string) =>
      guardrail({
        name,
        phase: 'output' as const,
        validate: async (content) => {
          seen.push(`${name}:${content}`)
          return {
            action: 'transform' as const,
            content: `${content}${suffix}`,
          }
        },
      })

    const safety = session({
      call: { guardrails: [tagging('o1', '-1'), tagging('o2', '-2')] },
    })
    const final = await safety.finalizeOutput({ text: 'y' }, noRegen)

    // o1 sees the raw text; o2 sees o1's transformed output.
    expect(seen).toEqual(['o1:y', 'o2:y-1'])
    expect(final.text).toBe('y-1-2')
  })

  it('stops at the first blocking output guard — a later guard never runs', async () => {
    const later = vi.fn()
    const blocker = guardrail({
      name: 'blk',
      phase: 'output',
      validate: async () => ({ action: 'block' as const, reason: 'bad' }),
    })
    const after = guardrail({
      name: 'aft',
      phase: 'output',
      validate: async () => {
        later()
        return { action: 'pass' as const }
      },
    })

    const safety = session({ call: { guardrails: [blocker, after] } })

    await expect(safety.finalizeOutput({ text: 'z' }, noRegen)).rejects.toBeInstanceOf(GuardrailBlockedError)
    expect(later).not.toHaveBeenCalled()
  })

  it('throws a GuardrailBlockedError carrying phase "output"', async () => {
    const blocker = guardrail({
      name: 'toxicity',
      phase: 'output',
      validate: async () => ({ action: 'block' as const, reason: 'toxic' }),
    })
    const safety = session({ call: { guardrails: [blocker] } })

    const error = await safety
      .finalizeOutput({ text: 'bad' }, noRegen)
      .then(() => undefined)
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(GuardrailBlockedError)
    const blocked = error as GuardrailBlockedError
    expect(blocked.guardrailId).toBe('toxicity')
    expect(blocked.phase).toBe('output')
    expect(blocked.reason).toBe('toxic')
  })
})

// ── Multiple constraints: combined corrective feedback ─────────────

describe('finalizeOutput — multiple constraints', () => {
  it('combines every failing constraint feedback into one corrective message for regenerate', async () => {
    const safety = session({
      call: {
        constraints: [needsNeedle('a', 'alpha'), needsNeedle('b', 'beta')],
      },
    })
    const regenerate = vi.fn(async (): Promise<SafetyOutput> => ({ text: 'alpha and beta' }))

    const final = await safety.finalizeOutput({ text: 'neither' }, regenerate)

    expect(final.text).toBe('alpha and beta')
    // One combined retry round, not one per failing constraint.
    expect(regenerate).toHaveBeenCalledTimes(1)
    const corrective = regenerate.mock.calls[0]![0] as readonly Message[]
    expect(corrective).toHaveLength(1)
    expect(corrective[0]?.content).toBe(
      [
        'Your previous output did not satisfy the following quality constraints. Please fix all issues in your next response.',
        '',
        '[a]: must mention alpha',
        '[b]: must mention beta',
      ].join('\n'),
    )
    // Both constraints pass on the re-checked output.
    expect(safety.audit.constraints?.allPassed).toBe(true)
  })
})

// ── Guardrail audit accumulation across phases ─────────────────────

describe('audit accumulation across phases', () => {
  it('accumulates input-phase and output-phase guardrail entries into one audit', async () => {
    const safety = session({
      call: {
        guardrails: [
          guardrail({
            name: 'in',
            phase: 'input',
            validate: async () => ({ action: 'pass' as const }),
          }),
          guardrail({
            name: 'out',
            phase: 'output',
            validate: async () => ({ action: 'pass' as const }),
          }),
        ],
      },
    })

    await safety.guardInput({ messages: [{ role: 'user', content: 'hi' }] })
    await safety.finalizeOutput({ text: 'out' }, noRegen)

    const applied = safety.audit.guardrails?.applied ?? []
    expect(applied.map((entry) => [entry.guard, entry.phase])).toEqual([
      ['in', 'input'],
      ['out', 'output'],
    ])
  })
})
