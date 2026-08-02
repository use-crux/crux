import type OpenAI from 'openai'
import type { ChatCompletion, ChatCompletionChunk } from 'openai/resources/chat/completions'
import type { Stream } from 'openai/streaming'
import type { ProviderConformanceEmission, ProviderRuntimeConformanceHarness } from '@use-crux/core/adapter'
import { describeCruxAdapterConformance } from '@use-crux/core/adapter/testing/vitest'
import { openaiProviderRuntime } from '../src'

interface CapturedOpenAIClient {
  readonly client: OpenAI
  readonly calls: unknown[]
}

describeCruxAdapterConformance({
  name: 'openai',
  runtime: openaiProviderRuntime,
  harness: openAIConformanceHarness(),
  capabilities: {
    ownership: 'single-turn',
    structuredOutput: true,
    streaming: true,
    toolCalls: true,
    agentTools: true,
    backgroundAgentWork: true,
    approvalSuspension: true,
    providerCache: true,
  },
})

function openAIConformanceHarness(): ProviderRuntimeConformanceHarness<OpenAI> {
  return {
    providerCache: {
      assertRequest: assertOpenAICacheNoop,
    },
    prepare(script) {
      const captured = capturedOpenAIClient({
        emissions: script.emissions,
        structuredTexts: script.structuredTexts,
        streamChunks: script.streamChunks,
      })

      return {
        client: captured.client,
        model: 'gpt-4o-conformance',
        inspect: {
          calls: () => captured.calls,
          messagesForCall: (index) => readRecord(captured.calls[index])?.messages,
          bodyForCall: (index) => captured.calls[index],
        },
      }
    },
  }
}

function assertOpenAICacheNoop(body: unknown): string | undefined {
  const serialized = JSON.stringify(body)
  for (const expected of [
    'Stable identity.',
    'Cached rule A.',
    'Cached rule B.',
    'Dynamic tail: Run the conformance scenario.',
  ]) {
    if (!serialized.includes(expected)) return `OpenAI request omitted ${expected}`
  }

  for (const forbidden of ['cache_control', 'cacheControl', 'cachedContent']) {
    if (serialized.includes(forbidden)) {
      return `OpenAI request unexpectedly included provider cache marker ${forbidden}`
    }
  }
  return undefined
}

function capturedOpenAIClient(script: {
  readonly emissions?: readonly ProviderConformanceEmission[]
  readonly structuredTexts?: readonly string[]
  readonly streamChunks?: readonly string[]
}): CapturedOpenAIClient {
  const calls: unknown[] = []
  const emissions = [...(script.emissions ?? [])]
  const structuredTexts = [...(script.structuredTexts ?? [])]

  const client = {
    chat: {
      completions: {
        create: async (request: unknown) => {
          calls.push(request)
          if (readRecord(request)?.stream === true) return openAIStream(script.streamChunks ?? [])
          return chatCompletion(emissions.shift() ?? { text: 'exhausted' }, calls.length)
        },
        parse: async (request: unknown) => {
          calls.push(request)
          return structuredCompletion(structuredTexts.shift() ?? '{}', calls.length)
        },
      },
    },
  } as unknown as OpenAI

  return { client, calls }
}

function chatCompletion(emission: ProviderConformanceEmission, sequence: number): ChatCompletion {
  const toolCalls = emission.toolCalls?.map((toolCall, index) => ({
    id: toolCall.id ?? `call_${sequence}_${index}`,
    type: 'function' as const,
    function: {
      name: toolCall.name,
      arguments: JSON.stringify(toolCall.args ?? {}),
    },
  }))

  return {
    id: `chatcmpl_conformance_${sequence}`,
    object: 'chat.completion',
    created: 0,
    model: 'gpt-4o-conformance-actual',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: emission.text ?? null,
          refusal: null,
          ...(toolCalls && toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: toolCalls && toolCalls.length > 0 ? 'tool_calls' : 'stop',
        logprobs: null,
      },
    ],
    usage:
      emission.usage === null
        ? undefined
        : emission.usage !== undefined
        ? {
            prompt_tokens: emission.usage.inputTokens,
            completion_tokens: emission.usage.outputTokens,
            total_tokens: emission.usage.totalTokens,
          }
        : { prompt_tokens: 13, completion_tokens: 8, total_tokens: 21 },
  } as unknown as ChatCompletion
}

function structuredCompletion(text: string, sequence: number): ChatCompletion {
  const parsed = parseJson(text)
  const completion = chatCompletion({ text }, sequence)
  return {
    ...completion,
    choices: [
      {
        ...completion.choices[0]!,
        message: {
          ...completion.choices[0]!.message,
          ...(parsed !== undefined ? { parsed } : {}),
        },
      },
    ],
  } as unknown as ChatCompletion
}

function openAIStream(chunks: readonly string[]): Stream<ChatCompletionChunk> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const content of chunks) {
        yield {
          id: 'chatcmpl_stream_conformance',
          object: 'chat.completion.chunk',
          created: 0,
          model: 'gpt-4o-conformance-actual',
          choices: [{ index: 0, delta: { content }, finish_reason: null }],
        } as ChatCompletionChunk
      }
    },
  } as unknown as Stream<ChatCompletionChunk>
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined
}
