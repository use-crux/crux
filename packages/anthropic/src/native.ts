import type Anthropic from "@anthropic-ai/sdk";
import {
  classifyProviderHttpError,
  CruxAdapterError,
  cruxProviderError,
  defineSingleTurnProviderBundle,
} from "@use-crux/core/adapter";
import type {
  CruxProviderError,
  NativeProviderPort,
  SingleTurnProviderBundleSpec,
} from "@use-crux/core/adapter";
import {
  judgeReranker,
  type Reranker,
  type RetrievalModel,
  type RetrieverHit,
} from "@use-crux/core/retrieval";
import { anthropicTranscript } from "./message-codec";
import { anthropicMediaHooks } from "./media-preflight";
import {
  anthropicOutputSchema,
  anthropicRequest,
  asAnthropicNonStreamingParams,
  asAnthropicStreamingParams,
  mapAnthropicSettings,
  stripDescriptions,
} from "./request-params";
import { anthropicResponseMeta, anthropicResponseText } from "./response";
import type { AnthropicParsedMessage } from "./response";
import { AnthropicChatStream, createAnthropicStreamCapture } from "./stream";
import type { AnthropicExtra, AnthropicRequest } from "./types";

/** Configuration for `anthropic.retrievalModel()`. */
export interface AnthropicRetrievalModelConfig {
  model: string;
}

/** Configuration for `anthropic.reranker()`. */
export interface AnthropicRerankerConfig extends AnthropicRetrievalModelConfig {
  name?: string;
  topN?: number;
  document?: (hit: RetrieverHit) => string;
}

/** Anthropic single-turn provider bundle compiled by core. */
const anthropic = defineSingleTurnProviderBundle({
  id: "anthropic",
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
        if (!isRecord(chunk) || chunk.type !== "content_block_delta")
          return undefined;
        const delta = chunk.delta;
        if (!isRecord(delta) || delta.type !== "text_delta") return undefined;
        return typeof delta.text === "string" ? delta.text : undefined;
      },
      completion: async (stream) => {
        let finalMsg: AnthropicParsedMessage;
        try {
          finalMsg = await stream.finalMessage();
        } catch (error) {
          // A finalMessage() rejection means the stream errored/aborted/failed
          // validation — surface it as a normalized error instead of silently
          // discarding it as "no completion metadata".
          const mapped = mapAnthropicError(error);
          throw new CruxAdapterError(
            cruxProviderError({
              kind: mapped?.kind ?? "provider-error",
              code: "anthropic.stream_completion_failed",
              retryable: mapped?.retryable ?? true,
              message: error instanceof Error ? error.message : error,
            }),
            { cause: error },
          );
        }
        const assistant = anthropicTranscript.readAssistant(finalMsg);
        const content =
          typeof assistant.content === "string"
            ? [{ type: "text" as const, text: assistant.content }]
            : assistant.content;
        return {
          ...anthropicResponseMeta(finalMsg),
          text: anthropicResponseText(finalMsg, assistant),
          ...(content !== undefined ? { content } : {}),
          ...(assistant.toolCalls !== undefined
            ? { toolCalls: [...assistant.toolCalls] }
            : {}),
        };
      },
    },
    mapError: mapAnthropicError,
    settings: mapAnthropicSettings,
    outputSchema: anthropicOutputSchema,
    sanitizeToolSchema: stripDescriptions,
    transcript: anthropicTranscript,
    media: anthropicMediaHooks,
  } satisfies SingleTurnProviderBundleSpec<
    Anthropic,
    AnthropicRequest,
    AnthropicParsedMessage,
    AnthropicChatStream,
    AnthropicExtra,
    Record<string, never>,
    Anthropic.MessageParam
  >["profile"],
  extend: ({ client }) => createAnthropicRuntimeExtensions(client),
});

/**
 * Public Anthropic provider runtime.
 *
 * Anthropic is a single-turn provider: the SDK exposes one message call or
 * stream per turn, while Crux owns prompt resolution, tool loops, validation
 * retry, safety, observability, and memory capture.
 */
export const anthropicProviderRuntime = anthropic.runtime;

/** Bind an Anthropic SDK client to the narrow native chat provider port. */
function bindAnthropic(
  client: Anthropic,
): NativeProviderPort<
  AnthropicRequest,
  AnthropicParsedMessage,
  AnthropicChatStream
> {
  return {
    call: (request, mode, options) =>
      mode === "structured"
        ? client.messages.parse(asAnthropicNonStreamingParams(request), {
            signal: options?.signal,
          })
        : client.messages.create(asAnthropicNonStreamingParams(request), {
            signal: options?.signal,
          }),
    stream: async (request, options) =>
      createAnthropicStreamCapture(
        client.messages.stream(asAnthropicStreamingParams(request), {
          signal: options?.signal,
        }),
      ),
  };
}

/** Classify an Anthropic SDK error into the normalized provider-error taxonomy. */
function mapAnthropicError(error: unknown): CruxProviderError | undefined {
  return classifyProviderHttpError(error, "anthropic");
}

/** Create an Anthropic adapter bound to a client instance. */
export const createAnthropic = anthropic.create;

/** Lightweight helper factory generated from the Anthropic provider runtime. */
export const anthropicHelpers = anthropic.helpers();

function createAnthropicRuntimeExtensions(client: Anthropic): {
  retrievalModel(config: AnthropicRetrievalModelConfig): RetrievalModel;
  reranker(config: AnthropicRerankerConfig): Reranker;
} {
  const retrievalModel = (
    config: AnthropicRetrievalModelConfig,
  ): RetrievalModel => {
    const generateText = anthropicHelpers.createGenerateTextFn(
      client,
      config.model,
    );
    const generateObject = anthropicHelpers.createGenerateObjectFn(
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
        name: config.name ?? "anthropic-judge",
        topN: config.topN,
        document: config.document,
      });
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
