import { describe, expect, it } from 'vitest'
import { normalizeUsage } from '../src/meta'

describe('normalizeUsage', () => {
  it('omits usage when the SDK omits token counts', () => {
    expect(normalizeUsage(undefined)).toBeUndefined()
  })

  it('normalizes AI SDK nested token details without fabricating missing fields', () => {
    expect(
      normalizeUsage({
        inputTokens: 11,
        outputTokens: 7,
        totalTokens: 18,
        inputTokenDetails: { cacheReadTokens: 5 },
        outputTokenDetails: { reasoningTokens: 3 },
      }),
    ).toEqual({
      inputTokens: 11,
      outputTokens: 7,
      totalTokens: 18,
      inputTokenDetails: { cacheReadTokens: 5 },
      outputTokenDetails: { reasoningTokens: 3 },
    })
  })
})
