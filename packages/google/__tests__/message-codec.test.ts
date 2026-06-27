import { describe, expect, it } from 'vitest'
import type { Content, GenerateContentResponse } from '@google/genai'
import type { Message } from '@use-crux/core'
import { transcriptCodecConformance } from '@use-crux/core/adapter/testing'
import type { ToolResultEntry } from '@use-crux/core/adapter'
import { fromMessages, googleTranscript, toMessages } from '../message-codec'

describe('google transcript wire encoding', () => {
  it('encodes assistant function calls and function responses to Google contents', () => {
    const contents = fromMessages([
      { role: 'system', content: 'Be terse.' },
      { role: 'user', content: 'Weather in Paris?' },
      {
        role: 'assistant',
        content: 'Checking',
        metadata: {
          toolCalls: [{ id: 'call_1', name: 'weather', args: { city: 'Paris' } }],
        },
      },
      toolMessage('call_1', 'weather', '{"temp":18}', {
        type: 'json',
        value: { temp: 18 },
      }),
    ])

    expect(contents).toEqual([
      { role: 'user', parts: [{ text: 'Weather in Paris?' }] },
      {
        role: 'model',
        parts: [
          { text: 'Checking' },
          {
            functionCall: {
              id: 'call_1',
              name: 'weather',
              args: { city: 'Paris' },
            },
          },
        ],
      },
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              id: 'call_1',
              name: 'weather',
              response: { output: { temp: 18 } },
            },
          },
        ],
      },
    ])
  })

  it('maps content tool outputs to Google function responses with media parts', () => {
    const contents = fromMessages([
      {
        role: 'tool',
        content: 'fallback',
        metadata: {
          toolCallId: 'call-1',
          toolName: 'renderImage',
          modelOutput: {
            type: 'content',
            value: [
              { type: 'text', text: 'Rendered image' },
              { type: 'image-data', data: 'base64-image', mediaType: 'image/png' },
            ],
          },
        },
      },
    ])

    expect(contents[0]).toEqual({
      role: 'user',
      parts: [
        {
          functionResponse: {
            id: 'call-1',
            name: 'renderImage',
            response: { output: 'Rendered image\n[image:image/png] data:base64-image' },
            parts: [{ inlineData: { data: 'base64-image', mimeType: 'image/png' } }],
          },
        },
      ],
    })
  })
})

describe('google transcript conformance', () => {
  it('passes the native transcript codec laws through one fixture', () => {
    const canonicalMessages: Message[] = [
      { role: 'user', content: 'Weather in Paris?' },
      {
        role: 'assistant',
        content: 'Checking',
        metadata: {
          toolCalls: [{ id: 'call_1', name: 'weather', args: { city: 'Paris' } }],
        },
      },
      toolMessage('call_1', 'weather', '{"temp":18}', {
        type: 'json',
        value: { temp: 18 },
      }),
    ]
    const providerMessages: Content[] = [
      { role: 'user', parts: [{ text: 'Weather in Paris?' }] },
      {
        role: 'model',
        parts: [
          { text: 'Checking' },
          {
            functionCall: {
              id: 'call_1',
              name: 'weather',
              args: { city: 'Paris' },
            },
          },
        ],
      },
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              id: 'call_1',
              name: 'weather',
              response: { output: { temp: 18 } },
            },
          },
        ],
      },
    ]
    const decodedMessages: Message[] = [
      { role: 'user', content: 'Weather in Paris?' },
      canonicalMessages[1]!,
      {
        role: 'tool',
        content: '{"output":{"temp":18}}',
        metadata: { toolCallId: 'call_1', toolName: 'weather' },
      },
    ]
    const assistant = {
      text: 'Checking',
      toolCalls: [{ id: 'call_1', name: 'weather', args: { city: 'Paris' } }],
    }
    const toolResults: ToolResultEntry[] = [
      {
        toolCallId: 'call_1',
        name: 'weather',
        output: { temp: 18 },
        modelOutput: { type: 'json', value: { temp: 18 } },
        content: '{"temp":18}',
        outputSize: 11,
        modelOutputSize: 11,
      },
    ]

    expect(
      transcriptCodecConformance({
        name: 'google transcript',
        transcript: googleTranscript,
        canonicalMessages,
        providerMessages,
        decodedMessages,
        rawAssistant: rawResponse('Checking', {
          id: 'call_1',
          name: 'weather',
          args: { city: 'Paris' },
        }),
        assistant,
        appendHistory: [canonicalMessages[0]!],
        toolResults,
        appendedMessages: [
          canonicalMessages[0]!,
          canonicalMessages[1]!,
          {
            role: 'tool',
            content: '{"temp":18}',
            metadata: {
              toolCallId: 'call_1',
              toolName: 'weather',
              modelOutput: { type: 'json', value: { temp: 18 } },
            },
          },
        ],
        wrappers: {
          fromMessages: fromMessages(canonicalMessages),
          toMessages: toMessages(providerMessages),
        },
      }),
    ).toEqual([])
  })
})

describe('google transcript wire decoding', () => {
  it('decodes every functionResponse part in a grouped tool-results content', () => {
    const messages = toMessages([
      {
        role: 'user',
        parts: [
          { functionResponse: { id: 'call_1', name: 'weather', response: { output: { temp: 18 } } } },
          { functionResponse: { id: 'call_2', name: 'calendar', response: { output: 'busy' } } },
        ],
      },
    ] satisfies Content[])

    expect(messages).toEqual([
      { role: 'tool', content: '{"output":{"temp":18}}', metadata: { toolCallId: 'call_1', toolName: 'weather' } },
      { role: 'tool', content: '{"output":"busy"}', metadata: { toolCallId: 'call_2', toolName: 'calendar' } },
    ])
  })
})

function toolMessage(
  toolCallId: string,
  toolName: string,
  content: string,
  modelOutput: NonNullable<ToolResultEntry['modelOutput']>,
): Message {
  return {
    role: 'tool',
    content,
    metadata: { toolCallId, toolName, modelOutput },
  }
}

function rawResponse(
  text: string,
  functionCall: { id: string; name: string; args: Record<string, unknown> },
): GenerateContentResponse {
  return {
    text,
    candidates: [{ content: { parts: [{ text }, { functionCall }] } }],
  } as unknown as GenerateContentResponse
}
