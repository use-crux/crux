import type {
  AdapterConformanceInspector,
  AdapterConformanceScript,
} from '../../src/adapter/testing'
import { defineNativeChatProvider } from '../../src/adapter/native-chat'
import type {
  NativeAssistantTurn,
  NativeProviderPort,
  NativeResponseMetadata,
} from '../../src/adapter/native-chat'
import type { CallArgs } from '../../src/adapter/types'
import type { Message } from '../../src/generation/messages'
import type { TokenUsage } from '../../src/generation/types'
import { permissiveCapabilities } from './structured-output/capability-fixtures'

interface NativeTestProviderMessage {
  readonly role: Message['role']
  readonly text: string
}

export interface NativeTestRequest {
  readonly model: string
  readonly mode: 'text' | 'structured'
  readonly system: string | undefined
  readonly messages: readonly NativeTestProviderMessage[]
  readonly settings: Record<string, unknown>
  readonly outputSchema: Record<string, unknown> | undefined
  readonly stream?: true
}

export interface NativeTestRawResponse {
  readonly id: string
  readonly model: string
  readonly text: string
  readonly structuredObject?: unknown
  readonly toolCalls?: readonly {
    readonly id: string
    readonly name: string
    readonly args: unknown
  }[]
  readonly usage: TokenUsage
  readonly finishReason: string
}

export interface NativeTestStream extends AsyncIterable<{ readonly delta: string }> {
  readonly chunks: readonly string[]
}

export interface NativeTestClient {
  readonly script: AdapterConformanceScript
  readonly calls: NativeTestRequest[]
  readonly streams: NativeTestRequest[]
}

export const nativeTestProfile = defineNativeChatProvider<
  NativeTestRequest,
  NativeTestRawResponse,
  NativeTestStream,
  Record<string, never>,
  Record<string, never>,
  NativeTestProviderMessage
>({
  providerId: 'native-test',

  request(
    args: CallArgs<Record<string, never>> & {
      readonly providerMessages: readonly NativeTestProviderMessage[]
    },
    ctx,
  ) {
    return {
      model: args.model,
      mode: ctx.mode,
      system: args.system,
      messages: args.providerMessages,
      settings: args.settings,
      outputSchema: ctx.outputSchema,
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
      usage: {
        inputTokens: 3,
        outputTokens: 2,
        totalTokens: 5,
        inputTokenDetails: {},
        outputTokenDetails: {},
      },
      finishReason: 'stop',
    }),
  },

  settings(settings) {
    return {
      ...(settings.temperature !== undefined ? { temperature: settings.temperature } : {}),
      ...(settings.maxTokens !== undefined ? { max_output_tokens: settings.maxTokens } : {}),
      ...(settings.topP !== undefined ? { top_p: settings.topP } : {}),
      ...(settings.stopSequences !== undefined ? { stop: settings.stopSequences } : {}),
    }
  },

  structuredOutput: { accepts: permissiveCapabilities },

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

export function bindNativeTest(
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
      const usage =
        emission.usage ??
        {
          inputTokens: 11,
          outputTokens: 7,
          totalTokens: 18,
          inputTokenDetails: {},
          outputTokenDetails: {},
        }

      return {
        id: `native_resp_${client.calls.length}`,
        model: 'native-test-actual',
        text: emission.text ?? '',
        toolCalls: emission.toolCalls?.map((toolCall, index) => ({
          id: toolCall.id ?? `tc_${index}`,
          name: toolCall.name,
          args: toolCall.args,
        })),
        usage,
        finishReason: emission.toolCalls?.length ? 'tool_calls' : 'stop',
      }
    },

    async stream(request) {
      client.streams.push(request)
      return streamFrom(client.script.streamChunks ?? ['he', 'llo'])
    },
  }
}

export function streamFrom(chunks: readonly string[]): NativeTestStream {
  return {
    chunks,
    async *[Symbol.asyncIterator]() {
      for (const delta of chunks) {
        yield { delta }
      }
    },
  }
}

export function inspectorFor(client: NativeTestClient): AdapterConformanceInspector {
  return {
    calls: () => client.calls,
    messagesForCall: (index) => client.calls[index]?.messages,
    bodyForCall: (index) => client.calls[index],
  }
}

function isNativeTestProviderMessage(value: unknown): value is NativeTestProviderMessage {
  return typeof value === 'object' && value !== null && 'role' in value && 'text' in value
}
