import type OpenAI from 'openai'
import type { ChatCompletion, ChatCompletionChunk } from 'openai/resources/chat/completions'
import type { Stream } from 'openai/streaming'
import { defineNativeChatProvider } from '@crux/core/adapter/native-chat'
import type { NativeProviderPort } from '@crux/core/adapter/native-chat'
import { fromMessages, toMessages } from './message-codec'
import {
  asOpenAINonStreamingParams,
  asOpenAIStreamingParams,
  openAIOutputSchema,
  openAIRequest,
  openAISettings,
  openAIStreamRequest,
} from './request'
import { openAIResponse } from './response'
import { openAITextDelta } from './stream'
import type { OpenAIChatRequest, OpenAIExtra } from './types'

/** OpenAI native chat profile compiled into the public Crux adapter API. */
const nativeOpenAI = defineNativeChatProvider<
  OpenAIChatRequest,
  ChatCompletion,
  Stream<ChatCompletionChunk>,
  OpenAIExtra
>({
  providerId: 'openai',
  request: openAIRequest,
  response: openAIResponse,
  stream: {
    request: openAIStreamRequest,
    textDelta: openAITextDelta,
  },
  settings: openAISettings,
  outputSchema: openAIOutputSchema,
  messages: {
    fromCrux: fromMessages,
    toCrux: (messages) => toMessages(messages),
  },
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

/** Native OpenAI `AdapterSpec`; exported for adapter conformance tests. */
export const openaiSpec = nativeOpenAI.specFor(bindOpenAI)

/** Create an OpenAI adapter bound to a client instance. */
export const createOpenAI = nativeOpenAI.createFor(bindOpenAI)

/** Lightweight helper factory generated from the OpenAI native chat profile. */
export const openAIHelpers = nativeOpenAI.helpers(bindOpenAI)
