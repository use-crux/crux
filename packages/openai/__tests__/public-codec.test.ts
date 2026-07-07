import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { prompt } from '@use-crux/core'
import { fromResponse, toParams } from '../index'
import type { ChatCompletion } from 'openai/resources/chat/completions'

describe('public OpenAI codecs', () => {
  it('turns a resolved prompt into OpenAI params and normalizes the response', async () => {
    const p = prompt({
      id: 'openai-codec-test',
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
    const params = toParams(resolved, {
      model: 'gpt-codec',
      settings: { maxTokens: 123 },
    })

    expect(params).toMatchObject({
      model: 'gpt-codec',
      temperature: 0.2,
      max_tokens: 123,
      messages: [
        { role: 'system', content: 'Speak plainly.' },
        { role: 'user', content: 'Say hello.' },
      ],
    })

    const facts = fromResponse({
      id: 'chatcmpl_codec',
      model: 'gpt-codec-actual',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'hello' },
        },
      ],
      usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
    } as ChatCompletion)

    expect(facts).toMatchObject({
      text: 'hello',
      finishReason: 'stop',
      responseId: 'chatcmpl_codec',
      actualModelId: 'gpt-codec-actual',
      usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 },
    })
  })
})
