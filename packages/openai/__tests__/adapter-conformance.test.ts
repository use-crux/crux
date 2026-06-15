import { describe, expect, it } from 'vitest'
import type OpenAI from 'openai'
import type { ChatCompletion, ChatCompletionChunk } from 'openai/resources/chat/completions'
import type { Stream } from 'openai/streaming'
import { z } from 'zod'
import { adapterSpecConformance } from '@crux/core/adapter/testing'
import type {
  AdapterConformanceHarness,
  AdapterConformanceInspector,
  AdapterConformanceScript,
} from '@crux/core/adapter/testing'
import type { CallArgs, ToolResultEntry } from '@crux/core/adapter'
import type { Message } from '@crux/core'
import { fromMessages, openaiSpec, toMessages } from '../index'
import type { OpenAIExtra } from '../index'

interface OpenAIFakeRequest {
  readonly method?: 'create' | 'parse'
  readonly model: unknown
  readonly messages?: unknown
  readonly stream?: unknown
  readonly response_format?: unknown
  readonly [key: string]: unknown
}

interface OpenAIFakeClient {
  readonly calls: OpenAIFakeRequest[]
  readonly script: AdapterConformanceScript
  readonly client: OpenAI
}

describe('OpenAI AdapterSpec conformance', () => {
  it('conforms to the native adapter contract', async () => {
    const harness: AdapterConformanceHarness<OpenAI, ChatCompletion, Stream<ChatCompletionChunk>, OpenAIExtra> = {
      capabilities: { responseId: 'required', actualModelId: 'required' },
      prepare: (script) => {
        const fake = createOpenAIFake(script)
        return { client: fake.client, model: 'gpt-4o-mini', inspect: inspectorFor(fake) }
      },
    }

    const violations = await adapterSpecConformance(openaiSpec, harness)

    expect(violations).toEqual([])
  })

  it('serializes assistant tool calls and tool results in the second call payload', async () => {
    const fake = createOpenAIFake({
      emissions: [
        { text: '', toolCalls: [{ id: 'call_weather', name: 'weather', args: { city: 'Paris' } }] },
        { text: 'Weather recorded.' },
      ],
    })

    const first = await openaiSpec.call(fake.client, callArgs())
    const messages = openaiSpec.appendToolRound([...BASE_MESSAGES], first.extracted, [weatherResult()])

    await openaiSpec.call(fake.client, callArgs({ messages }))

    expect(fake.calls[1]?.messages).toEqual([
      { role: 'system', content: 'System.' },
      { role: 'user', content: 'Weather in Paris?' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_weather',
            type: 'function',
            function: { name: 'weather', arguments: '{"city":"Paris"}' },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'call_weather',
        content: '18 C and cloudy',
      },
    ])
  })

  it('public fromMessages serializes assistant tool calls', () => {
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
        content: null,
        tool_calls: [
          {
            id: 'call_weather',
            type: 'function',
            function: { name: 'weather', arguments: '{"city":"Paris"}' },
          },
        ],
      },
    ])
  })

  it('public toMessages reads assistant tool calls and tool results', () => {
    const messages = toMessages([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_weather',
            type: 'function',
            function: { name: 'weather', arguments: '{"city":"Paris"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_weather', name: 'weather', content: '18 C and cloudy' },
    ])

    expect(messages).toEqual([
      {
        role: 'assistant',
        content: '',
        metadata: { toolCalls: [{ id: 'call_weather', name: 'weather', args: { city: 'Paris' } }] },
      },
      {
        role: 'tool',
        content: '18 C and cloudy',
        metadata: { toolCallId: 'call_weather', toolName: 'weather' },
      },
    ])
  })

  it('uses OpenAI parse with response_format for structured output', async () => {
    const fake = createOpenAIFake({ structuredTexts: ['{"ok":true}'] })
    const schema = z.object({ ok: z.boolean() })
    const schemaParams = openaiSpec.wrapOutputSchema?.(schema)

    await openaiSpec.call(fake.client, callArgs({ schema, schemaParams }))

    expect(fake.calls[0]).toMatchObject({
      method: 'parse',
      response_format: expect.objectContaining({ type: 'json_schema' }),
    })
  })
})

const BASE_MESSAGES: readonly Message[] = [{ role: 'user', content: 'Weather in Paris?' }]

function callArgs(overrides: Partial<CallArgs<OpenAIExtra>> = {}): CallArgs<OpenAIExtra> {
  return {
    model: 'gpt-4o-mini',
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

function weatherResult(): ToolResultEntry {
  return {
    toolCallId: 'call_weather',
    name: 'weather',
    output: { temperature: 18 },
    modelOutput: { type: 'text', value: '18 C and cloudy' },
    content: '18 C and cloudy',
    outputSize: 25,
    modelOutputSize: 15,
  }
}

function createOpenAIFake(script: AdapterConformanceScript): OpenAIFakeClient {
  const calls: OpenAIFakeRequest[] = []
  const fake = {
    calls,
    script,
    chat: {
      completions: {
        create: async (request: OpenAIFakeRequest) => {
          calls.push({ ...request, method: 'create' })
          return request.stream === true
            ? openAIStream(script.streamChunks ?? ['he', 'llo'])
            : chatResponse(script.emissions?.[calls.length - 1] ?? { text: 'ok' }, calls.length)
        },
        parse: async (request: OpenAIFakeRequest) => {
          calls.push({ ...request, method: 'parse' })
          const text = script.structuredTexts?.[calls.length - 1] ?? '{"ok":true}'
          return chatResponse({ text, parsed: JSON.parse(text) }, calls.length)
        },
      },
    },
  }
  return { calls, script, client: fake as unknown as OpenAI }
}

function inspectorFor(fake: OpenAIFakeClient): AdapterConformanceInspector {
  return {
    calls: () => fake.calls,
    messagesForCall: (index) => fake.calls[index]?.messages,
    bodyForCall: (index) => fake.calls[index],
  }
}

function chatResponse(
  emission: { readonly text?: string; readonly parsed?: unknown; readonly toolCalls?: readonly OpenAIToolCall[] },
  index: number,
): ChatCompletion {
  const toolCalls = emission.toolCalls?.map((toolCall) => ({
    id: toolCall.id ?? `call_${index}`,
    type: 'function' as const,
    function: {
      name: toolCall.name,
      arguments: JSON.stringify(toolCall.args),
    },
  }))

  return {
    id: `chatcmpl_${index}`,
    object: 'chat.completion',
    created: 0,
    model: 'gpt-4o-mini-actual',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: emission.text ?? null,
          ...(toolCalls ? { tool_calls: toolCalls } : {}),
          ...(emission.parsed !== undefined ? { parsed: emission.parsed } : {}),
        },
        finish_reason: toolCalls?.length ? 'tool_calls' : 'stop',
      },
    ],
    usage: { prompt_tokens: 13, completion_tokens: 8, total_tokens: 21 },
  } as unknown as ChatCompletion
}

interface OpenAIToolCall {
  readonly id?: string
  readonly name: string
  readonly args: unknown
}

function openAIStream(chunks: readonly string[]): Stream<ChatCompletionChunk> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const content of chunks) {
        yield { choices: [{ delta: { content } }] }
      }
    },
  } as unknown as Stream<ChatCompletionChunk>
}
