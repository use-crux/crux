import type OpenAI from 'openai'
import type { ChatCompletion, ChatCompletionChunk } from 'openai/resources/chat/completions'
import type { Stream } from 'openai/streaming'
import { defineAdapterProfile, nativeChat } from '@crux/core/adapter/profile'
import type { NativeChatProfile, NativeProviderPort } from '@crux/core/adapter/profile'
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

/** OpenAI provider hooks shared by the public profile and lightweight helpers. */
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
  NativeChatProfile<
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

/** OpenAI profile hooks including the client binder. */
const openAIProfileHooks = {
  bind: bindOpenAI,
  ...openAIProviderHooks,
} satisfies NativeChatProfile<
  OpenAI,
  OpenAIChatRequest,
  ChatCompletion,
  Stream<ChatCompletionChunk>,
  OpenAIExtra,
  Record<string, never>,
  OpenAI.ChatCompletionMessageParam
>

const openAINativeDriver = nativeChat(openAIProfileHooks)

/** Public OpenAI adapter profile. */
export const openaiProfile = defineAdapterProfile({
  id: 'openai',
  driver: openAINativeDriver,
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
export const createOpenAI = openaiProfile.create

/** Lightweight helper factory generated from the OpenAI native chat profile. */
export const openAIHelpers = openAINativeDriver.helpers('openai')
