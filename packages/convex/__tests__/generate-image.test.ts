import { describe, expect, expectTypeOf, it } from 'vitest'
import { generateImage as aiGenerateImage } from '@use-crux/ai'
import { imageGenerationConformanceRow } from '@use-crux/core/adapter/testing'
import { Agent, generateImage } from '../src/agent'

describe('Convex image generation parity', () => {
  it('is the exact AI SDK export with no Agent or storage wrapper', () => {
    expect(imageGenerationConformanceRow('convex').support).toBe('exact-ai-re-export')
    expect(generateImage).toBe(aiGenerateImage)
    expect(Object.hasOwn(Agent.prototype, 'generateImage')).toBe(false)
    expectTypeOf<InstanceType<typeof Agent>>().not.toHaveProperty('generateImage')
  })
})
