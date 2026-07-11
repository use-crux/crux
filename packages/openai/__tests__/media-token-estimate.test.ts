import { describe, expect, it } from 'vitest'
import { estimateOpenAIMediaTokens } from '../src/media-token-estimate'

describe('OpenAI media token estimation', () => {
  it('defers model/detail-dependent input to the deterministic core fallback', () => {
    expect(estimateOpenAIMediaTokens({ model: 'gpt-4o' })).toBeUndefined()
  })
})
