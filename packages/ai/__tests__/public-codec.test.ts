import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { LanguageModel } from 'ai'
import { prompt } from '@use-crux/core'
import { fromResponse, toParams } from '../index'

describe('public AI SDK codecs', () => {
  it('turns a resolved prompt into AI SDK args and normalizes the response', async () => {
    const model = { provider: 'openai', modelId: 'gpt-codec' } as unknown as LanguageModel
    const p = prompt({
      id: 'ai-codec-test',
      system: 'Speak plainly.',
      prompt: ({ input }) => `Say ${input.word}.`,
      input: z.object({ word: z.string() }),
      settings: { temperature: 0.2 },
    })

    const resolved = await p.resolve({
      input: { word: 'hello' },
      provider: 'openai',
      modelId: 'gpt-codec',
    })
    const args = toParams(resolved, {
      model,
      settings: { maxTokens: 123 },
    })

    expect(args).toMatchObject({
      model,
      system: 'Speak plainly.',
      prompt: 'Say hello.',
      temperature: 0.2,
      maxOutputTokens: 123,
    })

    const facts = fromResponse({
      text: 'hello',
      usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 },
      finishReason: 'stop',
      response: { id: 'ai_codec', modelId: 'gpt-codec-actual' },
    })

    expect(facts).toMatchObject({
      text: 'hello',
      finishReason: 'stop',
      responseId: 'ai_codec',
      actualModelId: 'gpt-codec-actual',
      usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 },
    })
  })
})
