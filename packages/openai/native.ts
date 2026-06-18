import type OpenAI from 'openai'
import type { ChatCompletion, ChatCompletionChunk } from 'openai/resources/chat/completions'
import type { Stream } from 'openai/streaming'
import { defineProviderRuntime } from '@crux/core/adapter'
import type { NativeProviderPort, SingleTurnProviderSpec } from '@crux/core/adapter'
import { openAITranscript } from './message-codec'
import {
  asOpenAINonStreamingParams,
  asOpenAIStreamingParams,
  openAIOutputSchema,
  openAIRequest,
  openAISettings,
  openAIStreamRequest,
} from './request'
import { openAIResponseMeta, openAIResponseText } from './response'
import { openAITextDelta } from './stream'
import type { OpenAIChatRequest, OpenAIExtra } from './types'

/** OpenAI provider hooks shared by the public runtime and lightweight helpers. */
const openAIProviderHooks = {
  request: openAIRequest,
  response: {
    meta: openAIResponseMeta,
    text: openAIResponseText,
  },
  stream: {
    request: openAIStreamRequest,
    textDelta: openAITextDelta,
  },
  settings: openAISettings,
  outputSchema: openAIOutputSchema,
  transcript: openAITranscript,
} satisfies Omit<
  SingleTurnProviderSpec<
    OpenAI,
    OpenAIChatRequest,
    ChatCompletion,
    Stream<ChatCompletionChunk>,
    OpenAIExtra,
    Record<string, never>,
    OpenAI.ChatCompletionMessageParam
  >,
  'bind'
>

/** OpenAI runtime hooks including the client binder. */
const openAIRuntimeHooks = {
  bind: bindOpenAI,
  ...openAIProviderHooks,
} satisfies SingleTurnProviderSpec<
  OpenAI,
  OpenAIChatRequest,
  ChatCompletion,
  Stream<ChatCompletionChunk>,
  OpenAIExtra,
  Record<string, never>,
  OpenAI.ChatCompletionMessageParam
>

/**
 * Public OpenAI provider runtime.
 *
 * OpenAI is a single-turn provider: the SDK exposes one chat call or stream
 * per turn, while Crux owns prompt resolution, tool loops, validation retry,
 * safety, observability, and memory capture.
 */
export const openaiProviderRuntime = defineProviderRuntime({
  id: 'openai',
  singleTurn: openAIRuntimeHooks,
})

/** Bind an OpenAI SDK client to the narrow native chat provider port. */
function bindOpenAI(
  client: OpenAI,
): NativeProviderPort<OpenAIChatRequest, ChatCompletion, Stream<ChatCompletionChunk>> {
  return {
    call: (request, mode) =>
      mode === 'structured'
        ? client.chat.completions.parse(asOpenAINonStreamingParams(request))
        : client.chat.completions.create(asOpenAINonStreamingParams(request)),
    stream: (request) => client.chat.completions.create(asOpenAIStreamingParams(request)),
  }
}

/** Create an OpenAI adapter bound to a client instance. */
export const createOpenAI = openaiProviderRuntime.create

/** Lightweight helper factory generated from the OpenAI provider runtime. */
export const openAIHelpers = openaiProviderRuntime.helpers()
