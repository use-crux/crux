import { describe, expect, expectTypeOf, it } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { transcriptionConformanceRow } from '@use-crux/core/adapter/testing'
import { createAnthropic } from '../src'

describe('Anthropic transcription parity', () => {
  it('omits transcription structurally at type and runtime levels', () => {
    const adapter = createAnthropic({} as Anthropic)
    expect(transcriptionConformanceRow('anthropic').support).toBe('absent')
    expect(Object.hasOwn(adapter, 'transcribe')).toBe(false)
    expectTypeOf(adapter).not.toHaveProperty('transcribe')
  })
})
