import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { LanguageModel } from 'ai'
import { UnsupportedContentError, imagePart, prompt, textPart } from '@use-crux/core'
import { fromResponse, toParams } from '../src'

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

  it('encodes canonical multimodal message parts into AI SDK model parts', async () => {
    const model = { provider: 'openai', modelId: 'gpt-codec' } as unknown as LanguageModel
    const p = prompt({
      id: 'ai-codec-multimodal-encode',
      prompt: 'fallback prompt',
    })

    const resolved = await p.resolve({
      provider: 'openai',
      modelId: 'gpt-codec',
    })
    const args = toParams(resolved, {
      model,
      messages: [
        {
          role: 'user',
          content: [
            textPart('Describe this chart.'),
            {
              ...imagePart({ data: new Uint8Array([1, 2, 3]), mediaType: 'image/png' }),
              providerOptions: { openai: { detail: 'low' } },
            },
            imagePart({ url: 'https://example.com/chart.png', mediaType: 'image/png' }),
          ],
        },
      ],
    })

    expect(args.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this chart.' },
          {
            type: 'image',
            image: 'AQID',
            mediaType: 'image/png',
            providerOptions: { openai: { detail: 'low' } },
          },
          {
            type: 'image',
            image: new URL('https://example.com/chart.png'),
            mediaType: 'image/png',
          },
        ],
      },
    ])
  })

  it('keeps unsupportedContent out of AI SDK params and honors strict mode before the call', async () => {
    const model = { provider: 'openai', modelId: 'gpt-codec' } as unknown as LanguageModel
    const p = prompt({
      id: 'ai-codec-unsupported-content',
      prompt: 'fallback prompt',
    })
    const resolved = await p.resolve({
      provider: 'openai',
      modelId: 'gpt-codec',
    })

    const degraded = toParams(resolved, {
      model,
      settings: { unsupportedContent: 'degrade' },
      messages: [{ role: 'user', content: [{ type: 'file-url', url: 'https://example.com/no-mime' }] }],
    })

    expect(degraded).not.toHaveProperty('unsupportedContent')
    expect(degraded.messages).toEqual([
      {
        role: 'user',
        content: [{ type: 'text', text: '[file https://example.com/no-mime]' }],
      },
    ])

    expect(() =>
      toParams(resolved, {
        model,
        settings: { unsupportedContent: 'error' },
        messages: [{ role: 'user', content: [{ type: 'file-url', url: 'https://example.com/no-mime' }] }],
      }),
    ).toThrow(UnsupportedContentError)
  })
})
