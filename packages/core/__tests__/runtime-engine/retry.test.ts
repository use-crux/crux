import { describe, expect, it } from 'vitest'
import { createRuntimeError } from '../../runtime/engine/errors'
import {
  classifyRuntimeFailure,
  retryDelayMs,
} from '../../runtime/engine/retry'

describe('runtime retry policy', () => {
  it('calculates full-jitter exponential backoff within the documented bounds', () => {
    expect(retryDelayMs({ attempt: 1, rng: () => 0 })).toBe(500)
    expect(retryDelayMs({ attempt: 1, rng: () => 1 })).toBe(1000)
    expect(retryDelayMs({ attempt: 2, rng: () => 1 })).toBe(2000)
    expect(retryDelayMs({ attempt: 20, rng: () => 1 })).toBe(3_600_000)
  })

  it('classifies ordinary failures as retryable until max attempts are exhausted', () => {
    expect(
      classifyRuntimeFailure(new Error('network'), {
        attempt: 7,
        maxAttempts: 8,
        rng: () => 0,
      }),
    ).toEqual({
      kind: 'retry',
      delayMs: 32_000,
    })
    expect(
      classifyRuntimeFailure(new Error('network'), {
        attempt: 8,
        maxAttempts: 8,
        rng: () => 0,
      }),
    ).toEqual({
      kind: 'dead-letter',
    })
  })

  it('classifies typed runtime diagnostics as terminal', () => {
    const error = createRuntimeError({
      code: 'TARGET_NOT_FOUND',
      whatFailed: 'Target `review` was not found.',
      why: 'The target was renamed or the generated entry file is stale.',
      whatStillWorks:
        'Existing object-bound flow handles can still be called directly.',
      nextStep: 'Run crux runtime generate and redeploy the wake handler.',
    })

    expect(
      classifyRuntimeFailure(error, { attempt: 1, maxAttempts: 8 }),
    ).toEqual({
      kind: 'terminal',
      code: 'TARGET_NOT_FOUND',
    })
  })
})
