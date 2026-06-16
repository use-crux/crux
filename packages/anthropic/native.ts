import type Anthropic from '@anthropic-ai/sdk'
import type { MessageStream } from '@anthropic-ai/sdk/lib/MessageStream'
import { defineNativeChatProvider } from '@crux/core/adapter/native-chat'
import type { NativeProviderPort } from '@crux/core/adapter/native-chat'
import { anthropicTranscript } from './message-codec'
import {
  anthropicOutputSchema,
  anthropicRequest,
  asAnthropicNonStreamingParams,
  asAnthropicStreamingParams,
  mapAnthropicSettings,
  stripDescriptions,
} from './request-params'
import { anthropicResponseMeta, anthropicResponseText } from './response'
import type { AnthropicParsedMessage } from './response'
import type { AnthropicExtra, AnthropicRequest } from './types'

/** Anthropic native chat profile compiled into the public Crux adapter API. */
const nativeAnthropic = defineNativeChatProvider<
  AnthropicRequest,
  AnthropicParsedMessage,
  MessageStream,
  AnthropicExtra,
  Record<string, never>,
  Anthropic.MessageParam
>({
  providerId: 'anthropic',
  request: anthropicRequest,
  response: {
    meta: anthropicResponseMeta,
    text: anthropicResponseText,
  },
  structuredObject: (raw) => raw.parsed_output,
  stream: {
    textDelta: (chunk) => {
      if (!isRecord(chunk) || chunk.type !== 'content_block_delta') return undefined
      const delta = chunk.delta
      if (!isRecord(delta) || delta.type !== 'text_delta') return undefined
      return typeof delta.text === 'string' ? delta.text : undefined
    },
    completion: async (stream) => {
      try {
        const finalMsg = await stream.finalMessage()
        return {
          usage: {
            inputTokens: finalMsg.usage.input_tokens,
            outputTokens: finalMsg.usage.output_tokens,
            totalTokens: finalMsg.usage.input_tokens + finalMsg.usage.output_tokens,
          },
        }
      } catch {
        return undefined
      }
    },
  },
  settings: mapAnthropicSettings,
  outputSchema: anthropicOutputSchema,
  sanitizeToolSchema: stripDescriptions,
  transcript: anthropicTranscript,
})

/** Bind an Anthropic SDK client to the narrow native chat provider port. */
function bindAnthropic(client: Anthropic): NativeProviderPort<AnthropicRequest, AnthropicParsedMessage, MessageStream> {
  return {
    call: (request, mode) =>
      mode === 'structured'
        ? client.messages.parse(asAnthropicNonStreamingParams(request))
        : client.messages.create(asAnthropicNonStreamingParams(request)),
    stream: async (request) => client.messages.stream(asAnthropicStreamingParams(request)),
  }
}

/** Native Anthropic `AdapterSpec`; exported for adapter conformance tests. */
export const anthropicSpec = nativeAnthropic.specFor(bindAnthropic)

/** Create an Anthropic adapter bound to a client instance. */
export const createAnthropic = nativeAnthropic.createFor(bindAnthropic)

/** Lightweight helper factory generated from the Anthropic native chat profile. */
export const anthropicHelpers = nativeAnthropic.helpers(bindAnthropic)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
