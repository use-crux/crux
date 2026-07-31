import { describe, expect, it } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import { anthropicModelCapacity, createAnthropic } from '../src'

describe('Anthropic model capacity', () => {
  it('reports known model families through the adapter', () => {
    const runtime = createAnthropic({} as Anthropic)

    expect(runtime.capacity('claude-sonnet-4-5-20250929')).toEqual({
      contextWindow: 200_000,
      defaultOutputReserve: 64_000,
      countingConfidence: 'estimated',
    })
    expect(runtime.capacity('claude-2.1').contextWindow).toBe(200_000)
  })

  it('uses the provider fallback for an unknown model', () => {
    expect(anthropicModelCapacity('future-model')).toEqual({
      contextWindow: 100_000,
      defaultOutputReserve: 8_192,
      countingConfidence: 'conservative',
    })
  })
})
