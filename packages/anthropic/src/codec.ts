import type Anthropic from '@anthropic-ai/sdk'
import type { Message, ResolvedPrompt, GenerationSettings } from '@use-crux/core'
import { callArgsFromResolvedPrompt, type AdapterResponse, type ToolDescriptor } from '@use-crux/core/adapter'
import {
  anthropicStructuredCapabilities,
  anthropicRequest,
  asAnthropicNonStreamingParams,
  mapAnthropicSettings,
} from './request-params'
import { compileStructuredOutput } from '@use-crux/core/adapter'
import { anthropicTranscript } from './message-codec'
import { extractAdapterResponse, type AnthropicParsedMessage } from './response'
import type { AnthropicExtra } from './types'

/** Options for Anthropic public {@link toParams} codec calls. */
export interface AnthropicCodecOptions {
  /** Anthropic model id to place in the request body. */
  readonly model: string
  /** Canonical settings merged after `resolved.settings`, then mapped to Anthropic fields. */
  readonly settings?: GenerationSettings
  /** Anthropic-specific request options. */
  readonly extra?: AnthropicExtra
  /** Optional conversation history override. */
  readonly messages?: readonly Message[]
  /** Prebuilt tool descriptors for translation-only codec calls. */
  readonly tools?: readonly ToolDescriptor[]
}

/** Convert a resolved Crux prompt into Anthropic message-create params. */
export function toParams(
  resolved: ResolvedPrompt,
  options: AnthropicCodecOptions,
): Anthropic.MessageCreateParamsNonStreaming {
  const generationSettings = {
    ...resolved.settings,
    ...(options.settings ?? {}),
  }
  const settings = mapAnthropicSettings(generationSettings)
  const callArgs = callArgsFromResolvedPrompt(resolved, {
      model: options.model,
      settings,
      extra: options.extra,
      messages: options.messages,
      tools: options.tools ? [...options.tools] : undefined,
      outputSchema: resolved.schema
        ? compileStructuredOutput(resolved.schema, anthropicStructuredCapabilities).outputSchema
        : undefined,
    })
  const request = anthropicRequest({
    ...callArgs,
    providerMessages: anthropicTranscript.fromMessages(callArgs.messages),
  })
  return asAnthropicNonStreamingParams(request)
}

/** Normalize an Anthropic SDK response into Crux response facts. */
export function fromResponse(response: AnthropicParsedMessage): AdapterResponse {
  return extractAdapterResponse(response)
}
