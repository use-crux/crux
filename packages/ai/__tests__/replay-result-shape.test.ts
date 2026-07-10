/**
 * Replayed-result shape — when the generation interceptor (the Quality
 * cassette runtime) short-circuits a spec call, the executor result carries
 * `raw: undefined`. The adapter's `generate()` then cannot return the SDK's
 * own result object and must surface a result-shaped fallback that still
 * carries everything consumers read: `text`, the parsed structured `object`,
 * `_meta`, and the canonical `messages`.
 *
 * Regression: the fallback dropped `object`, so structured prompts replayed
 * from cassettes produced `undefined` outputs in Quality runs while live
 * recording runs (raw present) passed.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { prompt as makePrompt } from '@use-crux/core'
import { clearGenerationInterceptor, setGenerationInterceptor } from '@use-crux/core/adapter'
import type { LanguageModel } from 'ai'
import { createCruxAi } from '../src'
import { scriptedGateway } from './scripted-gateway'

function model(id = 'gpt-4o', provider = 'openai'): LanguageModel {
  return { provider, modelId: id, specificationVersion: 'v3' } as unknown as LanguageModel
}

const objectPrompt = makePrompt({
  id: 'replay-object',
  system: 'Return JSON.',
  prompt: ({ input }) => (input as { message: string }).message,
  input: z.object({ message: z.string() }),
  output: z.object({ title: z.string(), count: z.number() }),
})

const textPrompt = makePrompt({
  id: 'replay-text',
  system: 'You are terse.',
  prompt: ({ input }) => (input as { message: string }).message,
  input: z.object({ message: z.string() }),
})

afterEach(() => {
  clearGenerationInterceptor()
})

describe('generate — replayed (raw: undefined) result shape', () => {
  it('carries the parsed object when a structured attempt is replayed', async () => {
    // Fabricated cassette replay: the spec call never runs; the outcome is
    // the revived recording (raw is never recorded, so it is undefined).
    setGenerationInterceptor(async () => ({
      status: 'ok',
      raw: undefined,
      response: {
        text: '{"title":"Replayed","count":2}',
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
          inputTokenDetails: {},
          outputTokenDetails: {},
        },
        finishReason: 'stop',
      },
      object: { title: 'Replayed', count: 2 },
    }))

    const scripted = scriptedGateway({})
    const ai = createCruxAi({ gateway: scripted.gateway })

    const result = (await ai.generate(objectPrompt, {
      model: model(),
      input: { message: 'go' },
    })) as unknown as { text: string; object?: unknown; messages?: unknown[]; _meta?: Record<string, unknown> }

    expect(result.object).toEqual({ title: 'Replayed', count: 2 })
    expect(result.text).toBe('{"title":"Replayed","count":2}')
    expect(result._meta).toBeDefined()
    expect(scripted.calls.generateObject).toHaveLength(0)
  })

  it('carries text and messages when a loop outcome is replayed', async () => {
    setGenerationInterceptor(async () => ({
      status: 'complete',
      raw: undefined,
      response: {
        text: 'replayed answer',
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
          inputTokenDetails: {},
          outputTokenDetails: {},
        },
        finishReason: 'stop',
      },
      messages: [
        { role: 'user', content: 'go' },
        { role: 'assistant', content: 'replayed answer' },
      ],
      steps: 1,
      meta: {},
    }))

    const scripted = scriptedGateway({})
    const ai = createCruxAi({ gateway: scripted.gateway })

    const result = (await ai.generate(textPrompt, {
      model: model(),
      input: { message: 'go' },
    })) as { text: string; messages?: { role: string }[] }

    expect(result.text).toBe('replayed answer')
    expect(result.messages?.map((message) => message.role)).toEqual(['user', 'assistant'])
    expect(scripted.calls.generateText).toHaveLength(0)
  })
})
