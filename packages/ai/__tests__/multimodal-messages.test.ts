import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { LanguageModel } from 'ai'
import { prompt } from '@use-crux/core'
import { createCruxAi } from '../src'
import { fromResponseMessages, toModelMessages } from '../src/messages'
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

  it('preserves multimodal tool-result content when building SDK model messages', () => {
    expect(
      toModelMessages([
        {
          role: 'tool',
          content: [
            { type: 'text', text: 'Screenshot captured.' },
            { type: 'image-data', data: 'AQID', mediaType: 'image/png' },
          ],
          metadata: { toolCallId: 'call_1', toolName: 'screenshot' },
        },
      ]),
    ).toEqual([
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call_1',
            toolName: 'screenshot',
            output: {
              type: 'content',
              value: [
                { type: 'text', text: 'Screenshot captured.' },
                { type: 'image-data', data: 'AQID', mediaType: 'image/png' },
              ],
            },
          },
        ],
      },
    ])
  })

  it('preserves assistant multimodal content when tool calls are present', () => {
    expect(
      toModelMessages([
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'I inspected the image.' },
            { type: 'file-data', data: 'JVBERi0x', mediaType: 'application/pdf', filename: 'report.pdf' },
          ],
          metadata: {
            toolCalls: [{ id: 'call_1', name: 'summarize', args: { id: 'report' } }],
          },
        },
      ]),
    ).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'I inspected the image.' },
          { type: 'file', data: 'JVBERi0x', mediaType: 'application/pdf', filename: 'report.pdf' },
          { type: 'tool-call', toolCallId: 'call_1', toolName: 'summarize', input: { id: 'report' } },
        ],
      },
    ])
  })

  it('routes unknown encode parts through the diagnostics sink', () => {
    const warnings: Array<{ message: string; detail?: unknown }> = []

    expect(
      toModelMessages(
        [
          {
            role: 'user',
            content: [{ type: 'provider-widget', widgetId: 'w1' }] as never,
          },
        ],
        {
          diagnostics: {
            warn(message, detail) {
              warnings.push({ message, detail })
            },
          },
        },
      ),
    ).toEqual([
      {
        role: 'user',
        content: [{ type: 'provider-widget', widgetId: 'w1' }],
      },
    ])
    expect(warnings).toEqual([
      {
        message: '[@use-crux/ai] Passing through unrecognized AI SDK content part.',
        detail: { partType: 'provider-widget' },
      },
    ])
  })

  it('preserves structured tool-result content from response messages', () => {
    expect(
      fromResponseMessages([
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'call_1',
              toolName: 'screenshot',
              output: {
                type: 'content',
                value: [
                  { type: 'text', text: 'Screenshot captured.' },
                  { type: 'image-data', data: 'AQID', mediaType: 'image/png' },
                ],
              },
            },
          ],
        },
      ]),
    ).toEqual([
      {
        role: 'tool',
        content: [
          { type: 'text', text: 'Screenshot captured.' },
          { type: 'image-data', data: 'AQID', mediaType: 'image/png' },
        ],
        metadata: { toolCallId: 'call_1', toolName: 'screenshot' },
      },
    ])
  })
})
