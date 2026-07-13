import { describe, expect, expectTypeOf, it } from 'vitest'
import { transcribe as aiTranscribe } from '@use-crux/ai'
import { transcriptionConformanceRow } from '@use-crux/core/adapter/testing'
import { Agent, transcribe } from '../src/agent'

describe('Convex transcription parity', () => {
  it('is the exact AI SDK export without Agent or storage behavior', () => {
    expect(transcriptionConformanceRow('convex').support).toBe('exact-ai-re-export')
    expect(transcribe).toBe(aiTranscribe)
    expect(Object.hasOwn(Agent.prototype, 'transcribe')).toBe(false)
    expectTypeOf<InstanceType<typeof Agent>>().not.toHaveProperty('transcribe')
  })
})
