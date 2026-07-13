import { describe, expect, it } from 'vitest'
import { estimateAnthropicMediaTokens } from '../src/media-token-estimate'

describe('Anthropic media token estimation', () => {
  it('uses the documented pixel formula only with known image dimensions', () => {
    expect(estimateAnthropicMediaTokens({
      model: 'claude-sonnet-4-5',
      media: { kind: 'image', width: 800, height: 600 },
    })).toBe(640)
    expect(estimateAnthropicMediaTokens({ model: 'claude-sonnet-4-5', media: { kind: 'image' } })).toBeUndefined()
    expect(estimateAnthropicMediaTokens({
      model: 'custom-claude',
      media: { kind: 'image', width: 800, height: 600 },
    })).toBeUndefined()
  })
})
