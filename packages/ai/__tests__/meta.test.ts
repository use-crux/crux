import { describe, expect, it } from 'vitest'
import { normalizeUsage } from '../src/meta'

describe('normalizeUsage', () => {
  it('leaves usage fields undefined when the SDK omits usage', () => {
    expect(normalizeUsage(undefined)).toEqual({
      inputTokens: undefined,
      outputTokens: undefined,
      totalTokens: undefined,
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined,
      reasoningTokens: undefined,
    })
  })
})
