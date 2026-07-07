import type OpenAI from 'openai'
import type { ChatCompletion } from 'openai/resources/chat/completions'
import type { GenerationSettings, Message, ResolvedPrompt } from '@use-crux/core'
import { callArgsFromResolvedPrompt, type AdapterResponse, type ToolDescriptor } from '@use-crux/core/adapter'
import {
  asOpenAINonStreamingParams,
  openAIOutputSchema,
  openAIRequest,
  openAISettings,
} from './request'
import { openAITranscript } from './message-codec'
import { openAIResponse } from './response'
import type { OpenAIExtra } from './types'

/** Options for OpenAI public {@link toParams} codec calls. */
export interface OpenAICodecOptions {
  /** OpenAI model id to place in the request body. */
  readonly model: string
  /** Canonical settings merged after `resolved.settings`, then mapped to OpenAI fields. */
  readonly settings?: GenerationSettings
  /** OpenAI-specific request options. */
  readonly extra?: OpenAIExtra
  /** Optional conversation history override. */
  readonly messages?: readonly Message[]
  /** Prebuilt tool descriptors for translation-only codec calls. */
  readonly tools?: readonly ToolDescriptor[]
}

/** Convert a resolved Crux prompt into OpenAI chat-completion params. */
export function toParams(
  resolved: ResolvedPrompt,
  options: OpenAICodecOptions,
): OpenAI.ChatCompletionCreateParamsNonStreaming {
  const settings = openAISettings({
    ...resolved.settings,
    ...(options.settings ?? {}),
  })
  const callArgs = callArgsFromResolvedPrompt(resolved, {
      model: options.model,
      settings,
      extra: options.extra,
      messages: options.messages,
      tools: options.tools ? [...options.tools] : undefined,
      schemaParams: resolved.schema ? openAIOutputSchema(resolved.schema) : undefined,
    })
  const request = openAIRequest({
    ...callArgs,
    providerMessages: openAITranscript.fromMessages(callArgs.messages),
  })
  return asOpenAINonStreamingParams(request)
}

/** Normalize an OpenAI SDK response into Crux response facts. */
export function fromResponse(response: ChatCompletion): AdapterResponse {
  return openAIResponse(response)
}
