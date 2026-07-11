import type OpenAI from "openai";
import type {
  ChatCompletion,
  ChatCompletionChunk,
} from "openai/resources/chat/completions";
import type { Stream } from "openai/streaming";
import { defineSingleTurnProviderBundle } from "@use-crux/core/adapter";
import type {
  NativeProviderPort,
  SingleTurnProviderBundleSpec,
} from "@use-crux/core/adapter";
import {
  judgeReranker,
  type Reranker,
  type RetrievalModel,
  type RetrieverHit,
} from "@use-crux/core/retrieval";
import { openAITranscript } from "./message-codec";
import { openAIMediaHooks } from "./media-preflight";
import {
  asOpenAINonStreamingParams,
  asOpenAIStreamingParams,
  openAIOutputSchema,
  openAIRequest,
  openAISettings,
  openAIStreamRequest,
} from "./request";
import { openAIResponseMeta, openAIResponseText } from "./response";
import { openAIStreamCompletion, openAITextDelta } from "./stream";
import type { OpenAIChatRequest, OpenAIExtra } from "./types";
import { createOpenAIImageOperation } from "./image-generation";
import { createOpenAITranscriptionOperation } from "./transcription";

/** Configuration for `openai.retrievalModel()`. */
export interface OpenAIRetrievalModelConfig {
  model: string;
}

/** Configuration for `openai.reranker()`. */
export interface OpenAIRerankerConfig extends OpenAIRetrievalModelConfig {
  name?: string;
  topN?: number;
  document?: (hit: RetrieverHit) => string;
}

/** OpenAI single-turn provider bundle compiled by core. */
const openAI = defineSingleTurnProviderBundle({
  id: "openai",
  bind: bindOpenAI,
  profile: {
    request: openAIRequest,
    response: {
      meta: openAIResponseMeta,
      text: openAIResponseText,
    },
    stream: {
      request: openAIStreamRequest,
      textDelta: openAITextDelta,
      completion: (_stream, chunks, request) =>
        openAIStreamCompletion(chunks, request),
    },
    settings: openAISettings,
    outputSchema: openAIOutputSchema,
    transcript: openAITranscript,
    media: openAIMediaHooks,
  } satisfies SingleTurnProviderBundleSpec<
    OpenAI,
    OpenAIChatRequest,
    ChatCompletion,
    Stream<ChatCompletionChunk>,
    OpenAIExtra,
    Record<string, never>,
    OpenAI.ChatCompletionMessageParam
  >["profile"],
  image: createOpenAIImageOperation,
  transcription: createOpenAITranscriptionOperation,
  extend: ({ client }) => createOpenAIRuntimeExtensions(client),
});

/**
 * Public OpenAI provider runtime.
 *
 * OpenAI is a single-turn provider: the SDK exposes one chat call or stream
 * per turn, while Crux owns prompt resolution, tool loops, validation retry,
 * safety, observability, and memory capture.
 */
export const openaiProviderRuntime = openAI.runtime;

/** Bind an OpenAI SDK client to the narrow native chat provider port. */
function bindOpenAI(
  client: OpenAI,
): NativeProviderPort<
  OpenAIChatRequest,
  ChatCompletion,
  Stream<ChatCompletionChunk>
> {
  return {
    call: (request, mode) =>
      mode === "structured"
        ? client.chat.completions.parse(asOpenAINonStreamingParams(request))
        : client.chat.completions.create(asOpenAINonStreamingParams(request)),
    stream: (request) =>
      client.chat.completions.create(asOpenAIStreamingParams(request)),
  };
}

/** Create an OpenAI adapter bound to a client instance. */
export const createOpenAI = openAI.create;

/** Lightweight helper factory generated from the OpenAI provider runtime. */
export const openAIHelpers = openAI.helpers();

function createOpenAIRuntimeExtensions(client: OpenAI): {
  retrievalModel(config: OpenAIRetrievalModelConfig): RetrievalModel;
  reranker(config: OpenAIRerankerConfig): Reranker;
} {
  const retrievalModel = (
    config: OpenAIRetrievalModelConfig,
  ): RetrievalModel => {
    const generateText = openAIHelpers.createGenerateTextFn(
      client,
      config.model,
    );
    const generateObject = openAIHelpers.createGenerateObjectFn(
      client,
      config.model,
    );
    return {
      generateText: (args) =>
        generateText(
          args.messages
            ? {
                model: config.model,
                system: args.system,
                maxOutputTokens: args.maxOutputTokens,
                messages: args.messages,
              }
            : {
                model: config.model,
                system: args.system,
                maxOutputTokens: args.maxOutputTokens,
                prompt: args.prompt ?? "",
              },
        ),
      generateObject: (args) =>
        generateObject({ ...args, model: config.model }),
    };
  };
  return {
    retrievalModel,
    reranker(config) {
      return judgeReranker({
        model: retrievalModel(config),
        name: config.name ?? "openai-judge",
        topN: config.topN,
        document: config.document,
      });
    },
  };
}
