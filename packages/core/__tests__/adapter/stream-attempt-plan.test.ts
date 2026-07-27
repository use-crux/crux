/**
 * Core-owned coordinated-stream plan for loop-owning SDK runtimes (RFC #173,
 * Phase 15, Fork A).
 *
 * The boundary under test: core decides WHETHER and WHY to retry (budget, eligibility,
 * corrective messages, typed terminal errors, attempt spans); the runtime only executes
 * the plan. No SDK types appear here — the plan is provider-neutral.
 *
 * @module
 */

import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { boundary, createSafety } from '../../src/safety'
import { constraint } from '../../src/safety/constraint'
import { StreamConstraintRejection } from '../../src/safety/constraint/settlement'
import { ConstraintViolationError } from '../../src/safety/constraint/errors'
import { ValidationExhaustedError } from '../../src/generation/validation-retry'
import { StreamValidationRejection } from '../../src/adapter/execution/stream-rejection'
import { createCoordinatedStreamPlan } from '../../src/adapter/execution/stream-attempt-plan-factory'
import { resetHooks } from '../../src/runtime/runtime'
import {
  resetObservabilityRuntime,
  subscribeObservability,
} from '../../src/observability'

afterEach(() => {
  resetHooks()
  resetObservabilityRuntime()
})

function zerr(): z.ZodError {
  return (z.number().safeParse('nope') as { error: z.ZodError }).error
}

function constraintRejection(
  name = 'c1',
  maxRetries = 2,
): StreamConstraintRejection {
  return new StreamConstraintRejection({
    failures: [{ name, severity: 'assert', feedback: 'nope', maxRetries }],
    text: 'bad',
    settlement: { attemptId: 'a', settled: [], audit: [] },
  })
}

function plan(overrides?: {
  readonly maxSteps?: number
  readonly validationRetry?: { maxRetries: number }
  readonly bufferUntilValidated?: boolean
  readonly signal?: AbortSignal
}) {
  const safety = createSafety({
    promptId: 'p',
    model: 'm',
    call: {
      constraints: [
        constraint({
          id: 'c1',
          on: boundary.output.text(),
          run: () => ({ pass: true }),
        }),
      ],
    },
  })
  let steps = 0
  return {
    steps: () => steps,
    plan: createCoordinatedStreamPlan({
      active: true,
      openAttemptSafety: () => safety.openStream(),
      bufferUntilValidated: overrides?.bufferUntilValidated ?? false,
      maxSteps: overrides?.maxSteps ?? 3,
      steps: () => steps,
      incrementStep: () => {
        steps += 1
      },
      formatFeedback: (failures) => [
        { role: 'user', content: failures.map((f) => f.feedback).join('; ') },
      ],
      guardFeedback: async (input) => input.text,
      ...(overrides?.validationRetry
        ? { validationRetry: overrides.validationRetry }
        : {}),
      ...(overrides?.signal ? { signal: overrides.signal } : {}),
      promptId: 'p',
    }),
  }
}

describe('coordinated stream plan (SDK port)', () => {
  it('begins the initial attempt with no corrective and counts one step', async () => {
    const harness = plan()
    const attempt = await harness.plan.beginAttempt()
    expect(attempt.attemptIndex).toBe(0)
    expect(attempt.cause).toBe('initial')
    expect(attempt.corrective).toEqual([])
    expect(attempt.signal.aborted).toBe(false)
    expect(harness.steps()).toBe(1)
    attempt.accept()
  })

  it('grants a constraint retry with corrective feedback and aborts the discarded attempt', async () => {
    const harness = plan()
    const first = await harness.plan.beginAttempt()
    first.reportSteps({ steps: 1, resumable: true })
    const next = await first.reject(constraintRejection())
    expect(first.signal.aborted).toBe(true) // discarded attempt is cancelled
    expect(next?.attemptIndex).toBe(1)
    expect(next?.cause).toBe('constraint-retry')
    expect(next?.corrective).toEqual([{ role: 'user', content: 'nope' }])
    expect(next?.rejectedOutput).toBe('bad')
    expect(harness.steps()).toBe(2)
    // Each attempt gets a FRESH safety stream (never reused across attempts).
    expect(next?.safety).not.toBe(first.safety)
  })

  it('grants a validation retry with validation feedback', async () => {
    const harness = plan({ validationRetry: { maxRetries: 2 } })
    const first = await harness.plan.beginAttempt()
    first.reportSteps({ steps: 1, resumable: true })
    const next = await first.reject(
      new StreamValidationRejection({ error: zerr(), text: 'bad' }),
    )
    expect(next?.cause).toBe('validation-retry')
    expect(String(next?.corrective[0]?.content)).toContain('Validation failed')
  })

  it('throws ConstraintViolationError when constraint retries are exhausted', async () => {
    const harness = plan()
    const first = await harness.plan.beginAttempt()
    first.reportSteps({ steps: 1, resumable: true })
    await expect(
      first.reject(constraintRejection('c1', 0)),
    ).rejects.toBeInstanceOf(ConstraintViolationError)
  })

  it('throws ValidationExhaustedError when validation retries are exhausted', async () => {
    const harness = plan({ validationRetry: { maxRetries: 0 } })
    const first = await harness.plan.beginAttempt()
    first.reportSteps({ steps: 1, resumable: true })
    const error = await first
      .reject(new StreamValidationRejection({ error: zerr(), text: 'bad' }))
      .catch((e) => e)
    expect(error).toBeInstanceOf(ValidationExhaustedError)
    expect((error as ValidationExhaustedError).attempts).toBe(0)
    expect((error as ValidationExhaustedError).maxAttempts).toBe(0)
  })

  it('refuses to start an attempt the shared budget cannot afford', async () => {
    const harness = plan({ maxSteps: 1 })
    const first = await harness.plan.beginAttempt() // consumes the only step
    await expect(first.reject(constraintRejection())).rejects.toBeInstanceOf(
      ConstraintViolationError,
    )
    expect(harness.steps()).toBe(1) // no second provider call was started
  })

  it('propagates a caller abort into the attempt signal', async () => {
    const controller = new AbortController()
    const harness = plan({ signal: controller.signal })
    const attempt = await harness.plan.beginAttempt()
    expect(attempt.signal.aborted).toBe(false)
    controller.abort()
    expect(attempt.signal.aborted).toBe(true)
  })

  it('surfaces bufferUntilValidated so the runtime holds output to EOF-and-validate', async () => {
    const harness = plan({
      bufferUntilValidated: true,
      validationRetry: { maxRetries: 1 },
    })
    const attempt = await harness.plan.beginAttempt()
    expect(attempt.bufferUntilValidated).toBe(true)
  })

  // Attempt spans use `implicitRun: false`: outside an owning `generation.stream` they
  // enrich nothing and must never manufacture a visible run of their own. (Span content
  // under a real stream is asserted in the native e2e coordinator test.)
  it('never manufactures a run for attempt spans outside an owning stream', async () => {
    const starts: Array<{ primitive?: string }> = []
    subscribeObservability(['span:start'], (r) => starts.push(r))

    const harness = plan()
    const first = await harness.plan.beginAttempt()
    first.reportSteps({ steps: 1, resumable: true })
    const next = await first.reject(constraintRejection())
    next?.accept()

    expect(starts.filter((s) => s.primitive === 'run')).toHaveLength(0)
    expect(
      starts.filter((s) => s.primitive === 'generation.stream'),
    ).toHaveLength(0)
  })
})

// Core owns the shared `maxSteps` budget; the adapter owns reporting how many model
// steps one SDK invocation actually consumed. Assuming one call equals one step let an
// SDK run tool rounds for free and could re-execute settled side effects on retry.
describe('SDK step ownership', () => {
  it('grants the remaining budget to each attempt', async () => {
    const { plan: p } = plan({ maxSteps: 3 })
    const first = await p.beginAttempt()
    // One step reserved for this attempt; the rest remain available to it.
    expect(first.remainingSteps).toBe(3)
  })

  it('deducts actual consumption, not one step per invocation', async () => {
    const { plan: p, steps } = plan({ maxSteps: 5 })
    const first = await p.beginAttempt()
    first.reportSteps({ steps: 2, resumable: true })
    const second = await first.reject(constraintRejection())
    expect(second).toBeDefined()
    // Attempt 0 consumed 2 of 5; attempt 1 reserves the next, leaving 2 for it.
    expect(second?.remainingSteps).toBe(3)
    expect(steps()).toBe(3)
  })

  it('stops retrying once reported consumption exhausts the budget', async () => {
    const { plan: p } = plan({ maxSteps: 2 })
    const first = await p.beginAttempt()
    first.reportSteps({ steps: 2, resumable: true })
    // The budget is spent by the first invocation's own internal steps.
    await expect(first.reject(constraintRejection())).rejects.toBeInstanceOf(
      ConstraintViolationError,
    )
  })

  it('fails closed when consumption was never reported', async () => {
    const { plan: p } = plan({ maxSteps: 5 })
    const first = await p.beginAttempt()
    // Unknown consumption is not retry-safe: no further provider call, and the caller
    // sees the typed terminal error rather than the internal non-terminal cause.
    await expect(first.reject(constraintRejection())).rejects.toBeInstanceOf(
      ConstraintViolationError,
    )
  })

  it('fails closed when settled tool rounds cannot be safely resumed', async () => {
    const { plan: p } = plan({ maxSteps: 5 })
    const first = await p.beginAttempt()
    // Multi-step invocation whose conversation cannot be replayed without re-running
    // its settled, side-effecting tools.
    first.reportSteps({ steps: 2, resumable: false })
    await expect(first.reject(constraintRejection())).rejects.toBeInstanceOf(
      ConstraintViolationError,
    )
  })

  it('allows a retry when a single-step attempt is resumable', async () => {
    const { plan: p } = plan({ maxSteps: 5 })
    const first = await p.beginAttempt()
    first.reportSteps({ steps: 1, resumable: true })
    await expect(first.reject(constraintRejection())).resolves.toBeDefined()
  })
})

// `reportSteps` is adapter-supplied data crossing a trust boundary. A malformed or
// over-budget claim is UNKNOWN consumption, not a usable count.
describe('reportSteps validation', () => {
  const bad: ReadonlyArray<readonly [string, number]> = [
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['beyond safe integer range', Number.MAX_SAFE_INTEGER + 2],
  ]

  for (const [label, steps] of bad) {
    it(`treats ${label} as unknown consumption and fails closed`, async () => {
      const { plan: p } = plan({ maxSteps: 5 })
      const first = await p.beginAttempt()
      first.reportSteps({ steps, resumable: true })
      await expect(first.reject(constraintRejection())).rejects.toBeInstanceOf(
        ConstraintViolationError,
      )
    })
  }

  it('rejects a claim larger than the granted budget', async () => {
    const { plan: p } = plan({ maxSteps: 2 })
    const first = await p.beginAttempt()
    // Claiming more than granted means the budget was already overrun.
    first.reportSteps({ steps: 99, resumable: true })
    await expect(first.reject(constraintRejection())).rejects.toBeInstanceOf(
      ConstraintViolationError,
    )
  })

  it('treats resumable:false as non-retryable even for a single step', async () => {
    const { plan: p } = plan({ maxSteps: 5 })
    const first = await p.beginAttempt()
    first.reportSteps({ steps: 1, resumable: false })
    await expect(first.reject(constraintRejection())).rejects.toBeInstanceOf(
      ConstraintViolationError,
    )
  })
})
