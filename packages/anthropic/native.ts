import type Anthropic from '@anthropic-ai/sdk'
import type { MessageStream } from '@anthropic-ai/sdk/lib/MessageStream'
import { defineSingleTurnProviderBundle } from '@use-crux/core/adapter'
import type {
  NativeProviderPort,
  SingleTurnProviderBundleSpec,
} from '@use-crux/core/adapter'
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

/** Anthropic single-turn provider bundle compiled by core. */
const anthropic = defineSingleTurnProviderBundle({
  id: 'anthropic',
  bind: bindAnthropic,
  profile: {
    request: anthropicRequest,
    response: {
      meta: anthropicResponseMeta,
      text: anthropicResponseText,
    },
    structuredObject: (raw) => raw.parsed_output,
    stream: {
      textDelta: (chunk) => {
        if (!isRecord(chunk) || chunk.type !== 'content_block_delta')
          return undefined
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
              totalTokens:
                finalMsg.usage.input_tokens + finalMsg.usage.output_tokens,
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
  } satisfies SingleTurnProviderBundleSpec<
    Anthropic,
    AnthropicRequest,
    AnthropicParsedMessage,
    MessageStream,
    AnthropicExtra,
    Record<string, never>,
    Anthropic.MessageParam
  >['profile'],
})

/**
 * Public Anthropic provider runtime.
 *
 * Anthropic is a single-turn provider: the SDK exposes one message call or
 * stream per turn, while Crux owns prompt resolution, tool loops, validation
 * retry, safety, observability, and memory capture.
 */
export const anthropicProviderRuntime = anthropic.runtime

/** Bind an Anthropic SDK client to the narrow native chat provider port. */
function bindAnthropic(
  client: Anthropic,
): NativeProviderPort<AnthropicRequest, AnthropicParsedMessage, MessageStream> {
  return {
    call: (request, mode) =>
      mode === 'structured'
        ? client.messages.parse(asAnthropicNonStreamingParams(request))
        : client.messages.create(asAnthropicNonStreamingParams(request)),
    stream: async (request) =>
      client.messages.stream(asAnthropicStreamingParams(request)),
  }
}

/** Create an Anthropic adapter bound to a client instance. */
export const createAnthropic = anthropic.create

/** Lightweight helper factory generated from the Anthropic provider runtime. */
export const anthropicHelpers = anthropic.helpers()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
