import { describe, expect, expectTypeOf, it } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { imageGenerationConformanceRow } from '@use-crux/core/adapter/testing'
import { createAnthropic } from '../src'

describe('Anthropic image generation parity', () => {
  it('omits generateImage structurally at type and runtime levels', () => {
    const adapter = createAnthropic({} as Anthropic)
    expect(imageGenerationConformanceRow('anthropic').support).toBe('absent')
    expect(Object.hasOwn(adapter, 'generateImage')).toBe(false)
    expectTypeOf(adapter).not.toHaveProperty('generateImage')
  })
})
