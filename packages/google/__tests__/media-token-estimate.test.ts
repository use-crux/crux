import { describe, expect, it } from 'vitest'
import { estimateGoogleMediaTokens } from '../src/media-token-estimate'

describe('Google media token estimation', () => {
  it('uses the documented audio rate only with a known duration', () => {
    expect(estimateGoogleMediaTokens({
      model: 'gemini-2.5-flash',
      media: { mediaType: 'audio/mpeg', durationInSeconds: 12.5 },
    })).toBe(400)
    expect(estimateGoogleMediaTokens({
      model: 'gemini-2.5-flash',
      media: { mediaType: 'audio/mpeg' },
    })).toBeUndefined()
    expect(estimateGoogleMediaTokens({
      model: 'custom-gemini',
      media: { mediaType: 'audio/mpeg', durationInSeconds: 12.5 },
    })).toBeUndefined()
  })
})
