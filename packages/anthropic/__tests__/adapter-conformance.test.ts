import { describe, expect, it } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import type { MessageStream } from '@anthropic-ai/sdk/lib/MessageStream'
import { adapterSpecConformance } from '@crux/core/adapter/testing'
import type {
  AdapterConformanceHarness,
  AdapterConformanceInspector,
  AdapterConformanceScript,
} from '@crux/core/adapter/testing'
import type { CallArgs, ToolResultEntry } from '@crux/core/adapter'
import type { Message, SystemBlock } from '@crux/core'
import { anthropicSpec, fromMessages, toMessages } from '../index'
import type { AnthropicExtra } from '../index'

interface AnthropicFakeRequest {
  readonly model: unknown
  readonly messages?: unknown
  readonly system?: unknown
  readonly output_config?: unknown
  readonly [key: string]: unknown
}

interface AnthropicFakeClient {
  readonly calls: AnthropicFakeRequest[]
  readonly script: AdapterConformanceScript
  readonly client: Anthropic
}

describe('Anthropic AdapterSpec conformance', () => {
  it('conforms to the native adapter contract', async () => {
    const harness: AdapterConformanceHarness<Anthropic, Anthropic.Message, MessageStream, AnthropicExtra> = {
      capabilities: { responseId: 'required', actualModelId: 'required', streamCompletion: 'required' },
      prepare: (script) => {
        const fake = createAnthropicFake(script)
        return { client: fake.client, model: 'claude-sonnet-4-5-20250929', inspect: inspectorFor(fake) }
      },
    }

    const violations = await adapterSpecConformance(anthropicSpec, harness)

    expect(violations).toEqual([])
  })

  it('serializes assistant tool_use and user tool_result blocks in the second call payload', async () => {
    const fake = createAnthropicFake({
      emissions: [
        { text: 'I will check.', toolCalls: [{ id: 'call_weather', name: 'weather', args: { city: 'Paris' } }] },
        { text: 'Weather recorded.' },
      ],
    })

    const first = await anthropicSpec.call(fake.client, callArgs())
    const messages = anthropicSpec.appendToolRound([...BASE_MESSAGES], first.extracted, [weatherErrorResult()])

    await anthropicSpec.call(fake.client, callArgs({ messages }))

    expect(fake.calls[1]?.messages).toEqual([
      { role: 'user', content: 'Weather in Paris?' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'I will check.' },
          { type: 'tool_use', id: 'call_weather', name: 'weather', input: { city: 'Paris' } },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call_weather',
            content: '{"error":"unavailable"}',
            is_error: true,
          },
        ],
      },
    ])
  })

  it('public fromMessages serializes assistant tool_use blocks', () => {
    const messages = fromMessages([
      {
        role: 'assistant',
        content: '',
        metadata: { toolCalls: [{ id: 'call_weather', name: 'weather', args: { city: 'Paris' } }] },
      },
    ])

    expect(messages).toEqual([
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'call_weather', name: 'weather', input: { city: 'Paris' } }],
      },
    ])
  })

  it('public toMessages reads assistant tool_use and user tool_result blocks', () => {
    const messages = toMessages([
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'call_weather', name: 'weather', input: { city: 'Paris' } }],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call_weather',
            content: '18 C and cloudy',
          },
        ],
      },
    ] as Anthropic.MessageParam[])

    expect(messages).toEqual([
      {
        role: 'assistant',
        content: '',
        metadata: { toolCalls: [{ id: 'call_weather', name: 'weather', args: { city: 'Paris' } }] },
      },
      {
        role: 'user',
        content: '',
        metadata: { toolResults: [{ toolCallId: 'call_weather', content: '18 C and cloudy' }] },
      },
    ])
  })

  it('emits cache_control on cacheable system blocks', async () => {
    const fake = createAnthropicFake({ emissions: [{ text: 'ok' }] })

    await anthropicSpec.call(
      fake.client,
      callArgs({
        system: 'Cached rules\n\nPrompt rules',
        systemBlocks: [
          { source: 'context:rules', text: 'Cached rules', providerCache: true },
          { source: 'prompt', text: 'Prompt rules', providerCache: false },
        ] satisfies SystemBlock[],
      }),
    )

    expect(fake.calls[0]?.system).toEqual([
      { type: 'text', text: 'Cached rules', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'Prompt rules' },
    ])
  })

  it('public fromMessages keeps native image and PDF tool_result content where supported', () => {
    const messages = fromMessages([
      {
        role: 'tool',
        content: 'fallback',
        metadata: {
          toolCallId: 'call_render',
          modelOutput: {
            type: 'content',
            value: [
              { type: 'text', text: 'Rendered report' },
              { type: 'image-data', data: 'base64-image', mediaType: 'image/png' },
              { type: 'file-data', data: 'base64-pdf', mediaType: 'application/pdf', filename: 'report.pdf' },
            ],
          },
        },
      },
    ])

    expect(messages).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call_render',
            content: [
              { type: 'text', text: 'Rendered report' },
              { type: 'image', source: { type: 'base64', data: 'base64-image', media_type: 'image/png' } },
              {
                type: 'document',
                source: { type: 'base64', data: 'base64-pdf', media_type: 'application/pdf' },
                title: 'report.pdf',
              },
            ],
          },
        ],
      },
    ])
  })
})

const BASE_MESSAGES: readonly Message[] = [{ role: 'user', content: 'Weather in Paris?' }]

function callArgs(overrides: Partial<CallArgs<AnthropicExtra>> = {}): CallArgs<AnthropicExtra> {
  return {
    model: 'claude-sonnet-4-5-20250929',
    system: 'System.',
    systemBlocks: undefined,
    messages: [...BASE_MESSAGES],
    settings: {},
    schema: undefined,
    schemaParams: undefined,
    tools: undefined,
    extra: {},
    ...overrides,
  }
}

function weatherErrorResult(): ToolResultEntry {
  return {
    toolCallId: 'call_weather',
    name: 'weather',
    output: { error: 'unavailable' },
    modelOutput: { type: 'error-json', value: { error: 'unavailable' } },
    content: '{"error":"unavailable"}',
    outputSize: 23,
    modelOutputSize: 23,
    isError: true,
  }
}

function createAnthropicFake(script: AdapterConformanceScript): AnthropicFakeClient {
  const calls: AnthropicFakeRequest[] = []
  const fake = {
    calls,
    script,
    messages: {
      create: async (request: AnthropicFakeRequest) => {
        calls.push(request)
        return anthropicMessage(script.emissions?.[calls.length - 1] ?? { text: 'ok' }, calls.length)
      },
      parse: async (request: AnthropicFakeRequest) => {
        calls.push(request)
        const text = script.structuredTexts?.[calls.length - 1] ?? '{"ok":true}'
        return { ...anthropicMessage({ text }, calls.length), parsed_output: JSON.parse(text) }
      },
      stream: (request: AnthropicFakeRequest) => {
        calls.push(request)
        return anthropicStream(script.streamChunks ?? ['he', 'llo'])
      },
    },
  }
  return { calls, script, client: fake as unknown as Anthropic }
}

function inspectorFor(fake: AnthropicFakeClient): AdapterConformanceInspector {
  return {
    calls: () => fake.calls,
    messagesForCall: (index) => fake.calls[index]?.messages,
    bodyForCall: (index) => fake.calls[index],
  }
}

function anthropicMessage(
  emission: {
    readonly text?: string
    readonly toolCalls?: readonly { readonly id?: string; readonly name: string; readonly args: unknown }[]
  },
  index: number,
): Anthropic.Message {
  return {
    id: `msg_${index}`,
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-5-actual',
    content: [
      ...(emission.text ? [{ type: 'text' as const, text: emission.text }] : []),
      ...(emission.toolCalls?.map((toolCall, toolIndex) => ({
        type: 'tool_use' as const,
        id: toolCall.id ?? `toolu_${toolIndex}`,
        name: toolCall.name,
        input: toolCall.args,
      })) ?? []),
    ],
    stop_reason: emission.toolCalls?.length ? 'tool_use' : 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 13, output_tokens: 8 },
  } as unknown as Anthropic.Message
}

function anthropicStream(chunks: readonly string[]): MessageStream {
  return {
    async *[Symbol.asyncIterator]() {
      for (const text of chunks) {
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text } }
      }
    },
    finalMessage: async () => anthropicMessage({ text: chunks.join('') }, 1),
  } as unknown as MessageStream
}
