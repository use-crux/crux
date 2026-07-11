import { describe, expect, it } from 'vitest'
import { IMAGE_GENERATION_CONFORMANCE, imageGenerationSupportProjection } from '../../src/adapter/testing'

describe('image generation support projection', () => {
  it('projects the tested five-adapter fixture without a runtime capability API', () => {
    expect(IMAGE_GENERATION_CONFORMANCE).toHaveLength(5)
    expect(imageGenerationSupportProjection()).toBe([
      '| ai-sdk | native |',
      '| anthropic | absent |',
      '| convex | exact AI SDK re-export |',
      '| google | native |',
      '| openai | native |',
    ].join('\n'))
  })
})
