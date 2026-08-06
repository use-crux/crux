import type Anthropic from '@anthropic-ai/sdk'
import type { MessageStream } from '@anthropic-ai/sdk/lib/MessageStream'
import type { ProviderConformanceEmission, ProviderRuntimeConformanceHarness } from '@use-crux/core/adapter/testing'
import { describeCruxAdapterConformance } from '@use-crux/core/adapter/testing/vitest'
import { anthropicProviderRuntime } from '../src'
import type { AnthropicParsedMessage } from '../src/response'

interface CapturedAnthropicClient {
  readonly client: Anthropic
  readonly calls: unknown[]
}

describeCruxAdapterConformance({
  name: 'anthropic',
  runtime: anthropicProviderRuntime,
  harness: anthropicConformanceHarness(),
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

function anthropicConformanceHarness(): ProviderRuntimeConformanceHarness<Anthropic> {
  return {
    providerCache: {
      assertRequest: assertAnthropicCacheBoundary,
    },
    prepare(script) {
      const captured = capturedAnthropicClient({
        emissions: script.emissions,
        structuredTexts: script.structuredTexts,
        streamChunks: script.streamChunks,
      })

      return {
        client: captured.client,
        model: 'claude-conformance',
        inspect: {
          calls: () => captured.calls,
          messagesForCall: (index) => readRecord(captured.calls[index])?.messages,
          bodyForCall: (index) => captured.calls[index],
        },
      }
    },
  }
}

function assertAnthropicCacheBoundary(body: unknown): string | undefined {
  const system = readRecord(body)?.system
  if (!Array.isArray(system)) return `expected Anthropic system blocks, got ${JSON.stringify(system)}`

  const markerBlocks = system.filter(
    (block) => readRecord(block)?.cache_control !== undefined,
  )
  if (markerBlocks.length !== 1) {
    return `expected one Anthropic cache_control marker, got ${markerBlocks.length}`
  }

  const marked = readRecord(markerBlocks[0])
  if (marked?.text !== 'Cached rule B.') {
    return `expected cache_control on "Cached rule B.", got ${JSON.stringify(marked)}`
  }

  const serialized = JSON.stringify(system)
  for (const expected of ['Stable identity.', 'Cached rule A.', 'Cached rule B.', 'Dynamic tail: Run the conformance scenario.']) {
    if (!serialized.includes(expected)) return `Anthropic request omitted ${expected}`
  }
  return undefined
}

function capturedAnthropicClient(script: {
  readonly emissions?: readonly ProviderConformanceEmission[]
  readonly structuredTexts?: readonly string[]
  readonly streamChunks?: readonly string[]
}): CapturedAnthropicClient {
  const calls: unknown[] = []
  const emissions = [...(script.emissions ?? [])]
  const structuredTexts = [...(script.structuredTexts ?? [])]

  const client = {
    messages: {
      create: async (request: unknown) => {
        calls.push(request)
        return anthropicMessage(emissions.shift() ?? { text: 'exhausted' }, calls.length)
      },
      parse: async (request: unknown) => {
        calls.push(request)
        return anthropicStructuredMessage(structuredTexts.shift() ?? '{}', calls.length)
      },
      stream: (request: unknown) => {
        calls.push(request)
        return anthropicStream(script.streamChunks ?? [])
      },
    },
  } as unknown as Anthropic

  return { client, calls }
}

function anthropicMessage(emission: ProviderConformanceEmission, sequence: number): AnthropicParsedMessage {
  const toolBlocks =
    emission.toolCalls?.map((toolCall, index) => ({
      type: 'tool_use' as const,
      id: toolCall.id ?? `call_${sequence}_${index}`,
      name: toolCall.name,
      input: toolInput(toolCall.args),
    })) ?? []

  return {
    id: `msg_conformance_${sequence}`,
    type: 'message',
    role: 'assistant',
    model: 'claude-conformance-actual',
    content: [...(emission.text ? [{ type: 'text' as const, text: emission.text }] : []), ...toolBlocks],
    stop_reason: toolBlocks.length > 0 ? 'tool_use' : 'end_turn',
    stop_sequence: null,
    usage:
      emission.usage === null
        ? undefined
        : emission.usage !== undefined
        ? { input_tokens: emission.usage.inputTokens, output_tokens: emission.usage.outputTokens }
        : { input_tokens: 13, output_tokens: 8 },
  } as AnthropicParsedMessage
}

function anthropicStructuredMessage(text: string, sequence: number): AnthropicParsedMessage {
  return {
    ...anthropicMessage({ text }, sequence),
    parsed_output: parseJson(text),
  }
}

function anthropicStream(chunks: readonly string[]): MessageStream {
  const finalMessage = anthropicMessage({ text: chunks.join('') }, 0)
  return {
    finalMessage: async () => finalMessage,
    async *[Symbol.asyncIterator]() {
      for (const text of chunks) {
        yield {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text },
        }
      }
    },
  } as unknown as MessageStream
}

function toolInput(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { value }
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
