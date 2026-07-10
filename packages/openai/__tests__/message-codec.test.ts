import { describe, expect, it } from 'vitest'
import type OpenAI from 'openai'
import type { ChatCompletion } from 'openai/resources/chat/completions'
import type { Message } from '@use-crux/core'
import { transcriptCodecConformance } from '@use-crux/core/adapter/testing'
import type { ToolResultEntry } from '@use-crux/core/adapter'
import { fromMessages, openAITranscript, toMessages } from '../src/message-codec'

describe('openai transcript wire encoding', () => {
  it('encodes assistant tool calls and tool results to chat-completion messages', () => {
    const messages = fromMessages([
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

    expect(messages).toEqual([
      { role: 'system', content: 'Be terse.' },
      { role: 'user', content: 'Weather in Paris?' },
      {
        role: 'assistant',
        content: 'Checking',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'weather', arguments: '{"city":"Paris"}' },
          },
        ],
      },
      { role: 'tool', content: '{"temp":18}', tool_call_id: 'call_1' },
    ])
  })

  it('rejects media tool outputs before OpenAI tool-message encoding', () => {
    expect(() => fromMessages([
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
              { type: 'image', source: 'https://example.com/chart.png' },
            ],
          },
        },
      },
    ])).toThrow('No provider request was made.')
  })
})

describe('openai transcript conformance', () => {
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
    const providerMessages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'user', content: 'Weather in Paris?' },
      {
        role: 'assistant',
        content: 'Checking',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'weather', arguments: '{"city":"Paris"}' },
          },
        ],
      },
      { role: 'tool', content: '{"temp":18}', tool_call_id: 'call_1' },
    ]
    const decodedMessages: Message[] = [
      { role: 'user', content: 'Weather in Paris?' },
      canonicalMessages[1]!,
      {
        role: 'tool',
        content: '{"temp":18}',
        metadata: { toolCallId: 'call_1' },
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
        name: 'openai transcript',
        transcript: openAITranscript,
        canonicalMessages,
        providerMessages,
        decodedMessages,
        rawAssistant: rawCompletion('Checking', {
          id: 'call_1',
          name: 'weather',
          arguments: '{"city":"Paris"}',
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

function rawCompletion(text: string, toolCall: { id: string; name: string; arguments: string }): ChatCompletion {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content: text,
          tool_calls: [
            {
              id: toolCall.id,
              type: 'function',
              function: { name: toolCall.name, arguments: toolCall.arguments },
            },
          ],
        },
      },
    ],
  } as unknown as ChatCompletion
}
