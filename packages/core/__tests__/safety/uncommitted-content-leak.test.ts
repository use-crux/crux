/**
 * No uncommitted candidate content reaches telemetry or public errors (RFC #173).
 *
 * Constraint feedback and metadata are policy-authored free text that commonly echoes
 * the selected model output, and a custom Zod refinement message can interpolate the
 * rejected value. Neither may escape through observability records or error surfaces
 * while (or after) the attempt is discarded.
 *
 * @module
 */

import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { boundary, createSafety } from '../../src/safety'
import { constraint } from '../../src/safety/constraint'
import { openSafetySessionStructuredStream } from '../../src/safety/session'
import { ValidationExhaustedError } from '../../src/generation/validation-retry'
import { resetHooks } from '../../src/runtime/runtime'
import { resetObservabilityRuntime, subscribeObservability } from '../../src/observability'

afterEach(() => {
  resetHooks()
  resetObservabilityRuntime()
})

const SECRET = 'leaked-model-output-9f3a'

describe('constraint feedback and metadata stay out of telemetry', () => {
  it('records no feedback or metadata content in any observability record', async () => {
    const records: unknown[] = []
    subscribeObservability((record) => records.push(record))

    const safety = createSafety({
      promptId: 'p',
      model: 'm',
      call: {
        constraints: [
          constraint({
            id: 'echoes-output',
            on: boundary.output.object<{ title: string; count: number }>(),
            // A policy that interpolates the model's own output into both channels.
            run: (obj: { title: string; count: number }) =>
              obj.count > 0
                ? { pass: true }
                : {
                    pass: false,
                    feedback: `Rejected: ${obj.title}`,
                    metadata: { offending: obj.title },
                  },
          }),
        ],
      },
    })
    const stream = openSafetySessionStructuredStream(safety, {})
    await stream.feed(`{"title":"${SECRET}","count":0}`)
    await stream.finish().catch(() => undefined)

    // Spans, events, artifacts, and edges are all scanned.
    expect(JSON.stringify(records)).not.toContain(SECRET)
    // The policy decision itself is still attributable.
    expect(JSON.stringify(records)).toContain('echoes-output')
  })
})

describe('ValidationExhaustedError exposes no rejected output', () => {
  it('keeps a custom refinement message out of the error and its evidence', () => {
    const schema = z.object({ secret: z.string() }).superRefine((value, ctx) => {
      ctx.addIssue({ code: 'custom', message: `rejected=${value.secret}`, path: ['secret'] })
    })
    const parsed = schema.safeParse({ secret: SECRET })
    expect(parsed.success).toBe(false)
    if (parsed.success) return

    const error = new ValidationExhaustedError({
      lastRawOutput: `{"secret":"${SECRET}"}`,
      zodErrors: parsed.error,
      attempts: 1,
      maxAttempts: 1,
      promptId: 'p',
    })

    // The custom refinement message never survives anywhere.
    const serialized = JSON.stringify({ ...error })
    expect(error.message).not.toContain(SECRET)
    expect(error.message).not.toContain('rejected=')
    expect(JSON.stringify(error.zodErrors)).not.toContain(SECRET)
    expect(JSON.stringify(error.issues)).not.toContain(SECRET)
    expect(serialized).not.toContain('rejected=')

    // The failure stays diagnosable: where it failed and which rule failed.
    expect(error.issues).toEqual([{ path: 'secret', depth: 1, code: 'custom' }])

    // Unconditional: nothing about the rejected candidate survives anywhere on a
    // public terminal error, including its capture summaries.
    expect(serialized).not.toContain(SECRET)
    expect(error.lastOutput.preview).toBeUndefined()
    expect(error.lastOutput.hash).toEqual(expect.any(String))
  })
})

// Validation evidence crosses a trust boundary in several ways at once: authored
// messages, model-controlled record keys, custom paths, and foreign error shapes.
describe('validation evidence sanitization', () => {
  it('drops model-controlled record keys from issue paths', () => {
    const schema = z.record(z.string(), z.number())
    const parsed = schema.safeParse({ [SECRET]: 'not-a-number' })
    expect(parsed.success).toBe(false)
    if (parsed.success) return
    const error = new ValidationExhaustedError({
      lastRawOutput: '{}',
      zodErrors: parsed.error,
      attempts: 0,
      maxAttempts: 0,
      promptId: 'p',
    })
    // The failing key IS the rejected content, so it must not appear in any surface.
    expect(JSON.stringify(error.issues)).not.toContain(SECRET)
    expect(JSON.stringify(error.zodErrors)).not.toContain(SECRET)
    // Structure is still reported.
    expect(error.issues[0]?.path).toBe('*')
    expect(error.issues[0]?.depth).toBe(1)
  })

  it('keeps static schema property names but not dynamic ones', () => {
    const schema = z.object({ title: z.string() })
    const parsed = schema.safeParse({ title: 1 })
    if (parsed.success) return
    const error = new ValidationExhaustedError({
      lastRawOutput: '{}',
      zodErrors: parsed.error,
      attempts: 0,
      maxAttempts: 0,
      promptId: 'p',
    })
    expect(error.issues[0]?.path).toBe('title')
  })

  it('never returns the original error when reconstruction throws', () => {
    // A foreign error whose constructor cannot be reinvoked.
    const foreign = {
      name: 'ZodError',
      message: `custom ${SECRET}`,
      issues: [{ code: 'custom', path: [SECRET], message: `msg ${SECRET}`, extra: SECRET }],
      constructor: function Throwing() {
        throw new Error('cannot reconstruct')
      },
    }
    const error = new ValidationExhaustedError({
      lastRawOutput: '{}',
      zodErrors: foreign as never,
      attempts: 0,
      maxAttempts: 0,
      promptId: 'p',
    })
    expect(JSON.stringify(error.zodErrors)).not.toContain(SECRET)
    expect(error.message).not.toContain(SECRET)
  })

  it('degrades safely for a malformed error with no issues', () => {
    const error = new ValidationExhaustedError({
      lastRawOutput: '{}',
      zodErrors: { message: SECRET } as never,
      attempts: 0,
      maxAttempts: 0,
      promptId: 'p',
    })
    expect(error.issues).toEqual([])
    expect(JSON.stringify(error.zodErrors)).not.toContain(SECRET)
  })
})
