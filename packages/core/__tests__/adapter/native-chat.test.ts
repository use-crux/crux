/**
 * The internal native-chat compiler should turn provider wire-format hooks into
 * the `AdapterSpec` contract without forcing profiles to restate Crux adapter
 * choreography.
 */

import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { adapterSpecConformance } from '../../adapter/testing'
import type {
  AdapterConformanceHarness,
  AdapterConformanceInspector,
  AdapterConformanceScript,
} from '../../adapter/testing'
import { defineNativeChatProvider } from '../../adapter/native-chat'
import type { NativeAssistantTurn, NativeProviderPort, NativeResponseMetadata } from '../../adapter/native-chat'
import type { CallArgs } from '../../adapter/types'
import type { Message } from '../../generation/messages'

interface NativeTestProviderMessage {
  readonly role: Message['role']
  readonly text: string
}

interface NativeTestRequest {
  readonly model: string
  readonly mode: 'text' | 'structured'
  readonly system: string | undefined
  readonly messages: readonly NativeTestProviderMessage[]
  readonly settings: Record<string, unknown>
  readonly schemaParams: Record<string, unknown> | undefined
  readonly stream?: true
}

interface NativeTestRawResponse {
  readonly id: string
  readonly model: string
  readonly text: string
  readonly structuredObject?: unknown
  readonly toolCalls?: readonly { readonly id: string; readonly name: string; readonly args: unknown }[]
  readonly usage: {
    readonly inputTokens: number
    readonly outputTokens: number
    readonly totalTokens: number
  }
  readonly finishReason: string
}

interface NativeTestStream extends AsyncIterable<{ readonly delta: string }> {
  readonly chunks: readonly string[]
}

interface NativeTestClient {
  readonly script: AdapterConformanceScript
  readonly calls: NativeTestRequest[]
  readonly streams: NativeTestRequest[]
}

const nativeTestProfile = defineNativeChatProvider<
  NativeTestRequest,
  NativeTestRawResponse,
  NativeTestStream,
  Record<string, never>,
  Record<string, never>,
  NativeTestProviderMessage
>({
  providerId: 'native-test',

  request(
    args: CallArgs<Record<string, never>> & { readonly providerMessages: readonly NativeTestProviderMessage[] },
    ctx,
  ) {
    return {
      model: args.model,
      mode: ctx.mode,
      system: args.system,
      messages: args.providerMessages,
      settings: args.settings,
      schemaParams: args.schemaParams,
    }
  },

  response: {
    meta(raw): NativeResponseMetadata {
      return {
        usage: { ...raw.usage },
        finishReason: raw.finishReason,
        responseId: raw.id,
        actualModelId: raw.model,
      }
    },
  },

  structuredObject: (raw) => raw.structuredObject,

  stream: {
    request: (request) => ({ ...request, stream: true }),
    textDelta: (chunk) =>
      typeof chunk === 'object' && chunk !== null && 'delta' in chunk
        ? String((chunk as { readonly delta: unknown }).delta)
        : undefined,
    completion: async () => ({
      usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
      finishReason: 'stop',
    }),
  },

  settings(settings) {
    return {
      ...(settings.temperature !== undefined ? { temperature: settings.temperature } : {}),
      ...(settings.maxTokens !== undefined ? { max_output_tokens: settings.maxTokens } : {}),
      ...(settings.stopSequences !== undefined ? { stop: settings.stopSequences } : {}),
    }
  },

  outputSchema(schema: z.ZodType) {
    return { response_schema: z.toJSONSchema(schema) }
  },

  transcript: {
    fromMessages: (messages) => messages.map((message) => ({ role: message.role, text: message.content })),
    toMessages: (messages) =>
      messages.flatMap((message) =>
        isNativeTestProviderMessage(message) ? [{ role: message.role, content: message.text }] : [],
      ),
    readAssistant(raw): NativeAssistantTurn {
      return {
        text: raw.text,
        toolCalls: raw.toolCalls ? raw.toolCalls.map((toolCall) => ({ ...toolCall })) : undefined,
      }
    },
  },
})

function bindNativeTest(
  client: NativeTestClient,
): NativeProviderPort<NativeTestRequest, NativeTestRawResponse, NativeTestStream> {
  return {
    async call(request, mode) {
      client.calls.push({ ...request, mode })
      const callIndex = client.calls.length - 1
      const emission =
        mode === 'structured'
          ? { text: client.script.structuredTexts?.[callIndex] ?? '{"ok":true}' }
          : (client.script.emissions?.[callIndex] ?? { text: 'ok' })
      const usage = emission.usage ?? { inputTokens: 11, outputTokens: 7, totalTokens: 18 }

      return {
        id: `native_resp_${client.calls.length}`,
        model: 'native-test-actual',
        text: emission.text ?? '',
        toolCalls: emission.toolCalls?.map((toolCall, index) => ({
          id: toolCall.id ?? `tc_${index}`,
          name: toolCall.name,
          args: toolCall.args,
        })),
        usage: {
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
          totalTokens: usage.totalTokens ?? 0,
        },
        finishReason: emission.toolCalls?.length ? 'tool_calls' : 'stop',
      }
    },

    async stream(request) {
      client.streams.push(request)
      return streamFrom(client.script.streamChunks ?? ['he', 'llo'])
    },
  }
}

function streamFrom(chunks: readonly string[]): NativeTestStream {
  return {
    chunks,
    async *[Symbol.asyncIterator]() {
      for (const delta of chunks) {
        yield { delta }
      }
    },
  }
}

function inspectorFor(client: NativeTestClient): AdapterConformanceInspector {
  return {
    calls: () => client.calls,
    messagesForCall: (index) => client.calls[index]?.messages,
    bodyForCall: (index) => client.calls[index],
  }
}

function isNativeTestProviderMessage(value: unknown): value is NativeTestProviderMessage {
  return typeof value === 'object' && value !== null && 'role' in value && 'text' in value
}

describe('native-chat compiler', () => {
  it('compiles a profile into a conforming AdapterSpec', async () => {
    const spec = nativeTestProfile.specFor(bindNativeTest)
    const harness: AdapterConformanceHarness<NativeTestClient, NativeTestRawResponse, NativeTestStream> = {
      prepare: (script) => {
        const client: NativeTestClient = { script, calls: [], streams: [] }
        return { client, model: 'native-test-model', inspect: inspectorFor(client) }
      },
    }

    const violations = await adapterSpecConformance(spec, harness)

    expect(violations).toEqual([])
  })

  it('creates lightweight helpers from the same profile request path', async () => {
    const helpers = nativeTestProfile.helpers(bindNativeTest)
    const textClient: NativeTestClient = {
      script: { emissions: [{ text: 'helper text' }] },
      calls: [],
      streams: [],
    }
    const generateText = helpers.createGenerateTextFn(textClient, 'native-test-model')

    await expect(
      generateText({ model: 'ignored-by-bound-helper', system: 'System', prompt: 'Write text' }),
    ).resolves.toEqual({
      text: 'helper text',
    })
    expect(textClient.calls[0]).toMatchObject({
      mode: 'text',
      model: 'native-test-model',
      system: 'System',
      messages: [{ role: 'user', text: 'Write text' }],
    })

    const objectClient: NativeTestClient = {
      script: { structuredTexts: ['{"ok":true}'] },
      calls: [],
      streams: [],
    }
    const generateObject = helpers.createGenerateObjectFn(objectClient, 'native-test-model')

    await expect(
      generateObject({
        model: 'ignored-by-bound-helper',
        prompt: 'Write JSON',
        schema: z.object({ ok: z.boolean() }),
      }),
    ).resolves.toEqual({ object: { ok: true } })
    expect(objectClient.calls[0]).toMatchObject({
      mode: 'structured',
      model: 'native-test-model',
      messages: [{ role: 'user', text: 'Write JSON' }],
    })
    expect(objectClient.calls[0]?.schemaParams).toHaveProperty('response_schema')
  })

  it('lets helper provider errors surface unchanged', async () => {
    const providerError = new Error('provider unavailable')
    const helpers = nativeTestProfile.helpers<NativeTestClient>(() => ({
      call: async () => {
        throw providerError
      },
      stream: async () => streamFrom([]),
    }))
    const generateText = helpers.createGenerateTextFn({ script: {}, calls: [], streams: [] }, 'native-test-model')

    await expect(generateText({ model: 'ignored', prompt: 'Write text' })).rejects.toBe(providerError)
  })

  it('lets object helpers consume provider-native parsed structured output', async () => {
    const helpers = nativeTestProfile.helpers<NativeTestClient>(() => ({
      call: async () => ({
        id: 'native_resp_structured',
        model: 'native-test-actual',
        text: 'not-json',
        structuredObject: { ok: true },
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        finishReason: 'stop',
      }),
      stream: async () => streamFrom([]),
    }))
    const generateObject = helpers.createGenerateObjectFn({ script: {}, calls: [], streams: [] }, 'native-test-model')

    await expect(
      generateObject({
        model: 'ignored',
        prompt: 'Write JSON',
        schema: z.object({ ok: z.boolean() }),
      }),
    ).resolves.toEqual({ object: { ok: true } })
  })
})
