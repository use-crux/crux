/**
 * `fakeNativeAdapter` must pass the native `AdapterSpec` conformance suite.
 *
 * Provider packages run this same suite with SDK-shaped fake clients so the
 * shared native adapter contract stays executable instead of living only in
 * documentation.
 */

import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { adapterSpecConformance } from '../../src/adapter/testing'
import type {
  AdapterConformanceHarness,
  AdapterConformanceInspector,
  AdapterConformanceScript,
} from '../../src/adapter/testing'
import type { AdapterSpec } from '../../src/adapter/spec'
import type { AdapterResponse, CallArgs, StreamHandle, ToolResultEntry } from '../../src/adapter/types'
import type { GenerationSettings, TokenUsage } from '../../src/generation/types'
import type { Message } from '../../src/generation/messages'
import { permissiveCapabilities } from './structured-output/capability-fixtures'

interface FakeNativeClient {
  readonly calls: FakeNativeBody[]
  readonly script: AdapterConformanceScript
}

interface FakeNativeBody {
  readonly model: string
  readonly system: string | undefined
  readonly messages: readonly Message[]
  readonly settings: Record<string, unknown>
  readonly outputSchema: Record<string, unknown> | undefined
}

interface FakeNativeRawResponse {
  readonly id: string
  readonly model: string
  readonly text: string
  readonly toolCalls?: readonly { readonly id: string; readonly name: string; readonly args: unknown }[]
  readonly usage: TokenUsage
  readonly finishReason: string
}

interface FakeNativeStream extends AsyncIterable<{ readonly delta: string }> {
  readonly chunks: readonly string[]
}

function createFakeNativeSpec(): AdapterSpec<FakeNativeClient, FakeNativeRawResponse, FakeNativeStream> {
  return {
    providerId: 'fake-native',

    async call(client, args) {
      client.calls.push({
        model: args.model,
        system: args.system,
        messages: args.messages,
        settings: args.settings,
        outputSchema: args.outputSchema,
      })

      const emission = args.outputSchema
        ? { text: client.script.structuredTexts?.[client.calls.length - 1] ?? '{"ok":true}' }
        : (client.script.emissions?.[client.calls.length - 1] ?? { text: 'ok' })

      const usage =
        emission.usage ??
        { inputTokens: 11, outputTokens: 7, totalTokens: 18, inputTokenDetails: {}, outputTokenDetails: {} }
      const raw: FakeNativeRawResponse = {
        id: `fake_resp_${client.calls.length}`,
        model: 'fake-native-actual',
        text: emission.text ?? '',
        toolCalls: emission.toolCalls?.map((toolCall, index) => ({
          id: toolCall.id ?? `tc_${index}`,
          name: toolCall.name,
          args: toolCall.args,
        })),
        usage,
        finishReason: emission.toolCalls?.length ? 'tool_calls' : 'stop',
      }

      return { raw, extracted: responseFromRaw(raw) }
    },

    async stream(client, args): Promise<StreamHandle<FakeNativeStream>> {
      client.calls.push({
        model: args.model,
        system: args.system,
        messages: args.messages,
        settings: args.settings,
        outputSchema: args.outputSchema,
      })
      const rawStream = streamFrom(client.script.streamChunks ?? ['he', 'llo'])
      return {
        rawStream,
        extractTextDelta: (chunk) =>
          typeof chunk === 'object' && chunk !== null && 'delta' in chunk
            ? String((chunk as { readonly delta: unknown }).delta)
            : undefined,
        completion: async () => ({
          usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5, inputTokenDetails: {}, outputTokenDetails: {} },
          finishReason: 'stop',
        }),
      }
    },

    appendToolRound(messages, assistantResponse, toolResults) {
      return [
        ...messages,
        {
          role: 'assistant' as const,
          content: assistantResponse.text,
          metadata: { toolCalls: assistantResponse.toolCalls },
        },
        ...toolResults.map((result) => toolResultMessage(result)),
      ]
    },

    mapSettings(settings: GenerationSettings): Record<string, unknown> {
      return {
        ...(settings.temperature !== undefined ? { temperature: settings.temperature } : {}),
        ...(settings.maxTokens !== undefined ? { max_output_tokens: settings.maxTokens } : {}),
        ...(settings.stopSequences !== undefined ? { stop: settings.stopSequences } : {}),
      }
    },

    structuredOutput: { accepts: permissiveCapabilities },
  }
}

function responseFromRaw(raw: FakeNativeRawResponse): AdapterResponse {
  return {
    text: raw.text,
    toolCalls: raw.toolCalls ? raw.toolCalls.map((toolCall) => ({ ...toolCall })) : undefined,
    usage: { ...raw.usage },
    finishReason: raw.finishReason,
    responseId: raw.id,
    actualModelId: raw.model,
  }
}

function toolResultMessage(result: ToolResultEntry): Message {
  return {
    role: 'tool',
    content: result.content,
    metadata: {
      toolCallId: result.toolCallId,
      toolName: result.name,
      modelOutput: result.modelOutput,
    },
  }
}

function streamFrom(chunks: readonly string[]): FakeNativeStream {
  return {
    chunks,
    async *[Symbol.asyncIterator]() {
      for (const delta of chunks) {
        yield { delta }
      }
    },
  }
}

function inspectorFor(client: FakeNativeClient): AdapterConformanceInspector {
  return {
    calls: () => client.calls,
    messagesForCall: (index) => client.calls[index]?.messages,
    bodyForCall: (index) => client.calls[index],
  }
}

describe('adapterSpecConformance', () => {
  it('fake native AdapterSpec conforms to the shared native contract', async () => {
    const spec = createFakeNativeSpec()
    const harness: AdapterConformanceHarness<FakeNativeClient, FakeNativeRawResponse, FakeNativeStream> = {
      prepare: (script) => {
        const client: FakeNativeClient = { calls: [], script }
        return { client, model: 'fake-native-model', inspect: inspectorFor(client) }
      },
    }

    const violations = await adapterSpecConformance(spec, harness)

    expect(violations).toEqual([])
  })
})
