import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { executeWithRetry } from '../retry'
import { ConstraintViolationError } from '../safety/constraint/errors'
import { GuardrailBlockedError } from '../safety/guardrail/errors'
import { ValidationExhaustedError } from '../validation-retry'

describe('executeWithRetry', () => {
  it('retries ordinary execution errors and returns the recovered value', async () => {
    let calls = 0

    const result = await executeWithRetry(
      async () => {
        calls += 1
        if (calls < 2) throw new Error('temporary outage')
        return 'ok'
      },
      { retry: { attempts: 2, delay: 0 } },
    )

    expect(result).toBe('ok')
    expect(calls).toBe(2)
  })

  it('uses fallback after retryable errors exhaust all attempts', async () => {
    let calls = 0

    const result = await executeWithRetry(
      async () => {
        calls += 1
        throw new Error('still down')
      },
      {
        retry: { attempts: 2, delay: 0 },
        fallback: () => 'fallback',
      },
    )

    expect(result).toBe('fallback')
    expect(calls).toBe(2)
  })

  it.each([
    [
      'guardrail blocks',
      new GuardrailBlockedError({
        guardrailId: 'pii',
        phase: 'input',
        reason: 'contains private data',
      }),
    ],
    [
      'constraint violations',
      new ConstraintViolationError({
        failedConstraints: [{ name: 'cite-sources', feedback: 'Missing citations' }],
        audit: { entries: [], allPassed: false, suggestFallback: false },
        lastOutput: 'uncited answer',
        totalAttempts: 1,
      }),
    ],
    [
      'exhausted validation',
      new ValidationExhaustedError({
        lastRawOutput: '{}',
        zodErrors: z.object({ answer: z.string() }).safeParse({ answer: 42 }).error!,
        attempts: 3,
        maxAttempts: 3,
        promptId: 'answer',
      }),
    ],
  ])('does not retry or fallback for %s by default', async (_label, error) => {
    let calls = 0
    let fallbackCalls = 0

    await expect(
      executeWithRetry(
        async () => {
          calls += 1
          throw error
        },
        {
          retry: { attempts: 3, delay: 0 },
          fallback: () => {
            fallbackCalls += 1
            return 'fallback'
          },
        },
      ),
    ).rejects.toBe(error)

    expect(calls).toBe(1)
    expect(fallbackCalls).toBe(0)
  })

  it('allows callers to override retry eligibility intentionally', async () => {
    let calls = 0

    const result = await executeWithRetry(
      async () => {
        calls += 1
        if (calls < 2) {
          throw new GuardrailBlockedError({
            guardrailId: 'temporary-policy',
            phase: 'output',
            reason: 'test override',
          })
        }
        return 'ok'
      },
      {
        retry: { attempts: 2, delay: 0 },
        shouldRetry: () => true,
      },
    )

    expect(result).toBe('ok')
    expect(calls).toBe(2)
  })
})
