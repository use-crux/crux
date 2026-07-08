import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { LanguageModel } from 'ai'
import { prompt } from '@use-crux/core'
import { createCruxAi } from '../index'
import { scriptedGateway } from './scripted-gateway'

function model(id = 'gpt-4o', provider = 'openai'): LanguageModel {
  return {
    provider,
    modelId: id,
    specificationVersion: 'v3',
  } as unknown as LanguageModel
}

const textPrompt = prompt({
  id: 'ai-multimodal-messages',
  prompt: ({ input }) => input.message,
  input: z.object({ message: z.string() }),
})

describe('AI SDK multimodal messages', () => {
  it('decodes assistant file outputs into canonical message content parts', async () => {
    const scripted = scriptedGateway({
      generateText: [
        {
          text: 'see attached',
          responseMessages: [
            {
              role: 'assistant',
              content: [
                { type: 'text', text: 'see attached' },
                {
                  type: 'file',
                  data: 'JVBERi0x',
                  mediaType: 'application/pdf',
                  filename: 'report.pdf',
                  providerOptions: { openai: { fileId: 'file_123' } },
                },
              ],
            },
          ],
        },
      ],
    })
    const ai = createCruxAi({ gateway: scripted.gateway })

    const result = await ai.generate(textPrompt, {
      model: model(),
      input: { message: 'make a report' },
    })

    expect(result.messages.at(-1)).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: 'see attached' },
        {
          type: 'file-data',
          data: 'JVBERi0x',
          mediaType: 'application/pdf',
          filename: 'report.pdf',
          providerOptions: { openai: { fileId: 'file_123' } },
        },
      ],
    })
  })

  it('normalizes SDK-shaped message history before building SDK call args', async () => {
    const scripted = scriptedGateway({ generateText: [{ text: 'ok' }] })
    const ai = createCruxAi({ gateway: scripted.gateway })

    await ai.generate(textPrompt, {
      model: model(),
      input: { message: 'ignored when messages are provided' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Look.' },
            { type: 'image', image: 'AQID', mediaType: 'image/png' },
          ],
        },
      ] as never,
    })

    expect(scripted.calls.generateText[0]!.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Look.' },
          { type: 'image', image: 'AQID', mediaType: 'image/png' },
        ],
      },
    ])
  })
})
