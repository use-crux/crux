import type {
  Content,
  GenerateContentResponse,
  GoogleGenAI,
} from "@google/genai";
import {
  classifyProviderHttpError,
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
import {
  disabledCachedContentLifecycle,
  resolveCachedContentLifecycle,
} from "./cached-content";
import type {
  GoogleCachedContentLifecycle,
  GoogleCachedContentOption,
} from "./cached-content";
import { googleTranscript } from "./message-codec";
import { googleMediaHooks } from "./media-preflight";
import {
  asGoogleGenerateContentParams,
  asGoogleGenerateContentStreamParams,
  googleStructuredCapabilities,
  googleRequest,
  googleSettings,
} from "./request";
import { googleResponseMeta, googleResponseText } from "./response";
import {
  createGoogleStreamCapture,
  GoogleChatStream,
  googleStreamCompletion,
  googleTextDelta,
} from "./stream";
import type { GoogleExtra, GoogleRequest } from "./types";
import { createGoogleImageOperation } from "./image-generation";
import { createGoogleTranscriptionOperation } from "./transcription";
import { createGoogleSpeechOperation } from "./speech";
import { materializeGoogleToolSource } from "./mcp-materializer";
import { googleModelCapacity } from "./capacity";
import { createGoogleImageStreamingOperation } from "./image-streaming";
import { createGoogleSpeechStreamingOperation } from "./speech-streaming";

/** Configuration for `google.retrievalModel()`. */
export interface GoogleRetrievalModelConfig {
  model: string;
}

/** Configuration for `google.reranker()`. */
export interface GoogleRerankerConfig extends GoogleRetrievalModelConfig {
  name?: string;
  topN?: number;
  document?: (hit: RetrieverHit) => string;
}

interface GoogleNativeDeps extends Record<string, unknown> {
  readonly cachedContentLifecycle?: GoogleCachedContentLifecycle;
}

/**
 * Fallback lifecycle for the raw runtime when no deps are supplied.
 *
 * `createGoogle()` always injects a real lifecycle, so this only applies to
 * direct `googleProviderRuntime.create(client, {})` usage, where caching is off.
 */
const DISABLED_CACHED_CONTENT = disabledCachedContentLifecycle();

/** Options for `createGoogle()`. */
export interface CreateGoogleOptions {
  /**
   * Configure Google's CachedContent API integration.
   *
   * - `undefined` / omitted: caching enabled with defaults
   * - `GoogleCacheConfig`: custom TTL, max entries, error mode, or cache port
   * - `false`: disable CachedContent management entirely
   * - `GoogleCachedContentLifecycle`: a fully custom lifecycle implementation
   */
  readonly cachedContent?: GoogleCachedContentOption;
}

/** Google single-turn provider bundle compiled by core. */
const google = defineSingleTurnProviderBundle({
  id: "google",
  bind: bindGoogle,
  profile: {
    capacity: googleModelCapacity,
    materializeToolSource: materializeGoogleToolSource,
    request: (args, { deps }) =>
      googleRequest(
        args,
        deps.cachedContentLifecycle ?? DISABLED_CACHED_CONTENT,
      ),
    response: {
      meta: googleResponseMeta,
      text: googleResponseText,
    },
    stream: {
      textDelta: googleTextDelta,
      completion: (_stream, chunks) => googleStreamCompletion(chunks),
    },
    mapError: mapGoogleError,
    settings: googleSettings,
    structuredOutput: { accepts: googleStructuredCapabilities },
    transcript: googleTranscript,
    media: googleMediaHooks,
  } satisfies SingleTurnProviderBundleSpec<
    GoogleGenAI,
    GoogleRequest,
    GenerateContentResponse,
    GoogleChatStream,
    GoogleExtra,
    GoogleNativeDeps,
    Content
  >["profile"],
  deps: {
    create: (
      client: GoogleGenAI,
      opts?: CreateGoogleOptions,
    ): GoogleNativeDeps => ({
      cachedContentLifecycle: resolveCachedContentLifecycle(
        client,
        opts?.cachedContent,
      ),
    }),
    // Lightweight helpers run plain text/object generation without system
    // blocks, so they leave caching off via the disabled fallback.
    helpers: (): GoogleNativeDeps => ({}),
  },
  image: createGoogleImageOperation,
  transcription: createGoogleTranscriptionOperation,
  speech: createGoogleSpeechOperation,
  streaming: {
    image: createGoogleImageStreamingOperation,
    speech: createGoogleSpeechStreamingOperation,
  },
  extend: ({ client }) => createGoogleRuntimeExtensions(client),
});

/**
 * Public Google provider runtime.
 *
 * Google is a single-turn provider: the SDK exposes one generate-content call
 * or stream per turn, while Crux owns prompt resolution, tool loops,
 * validation retry, safety, observability, and memory capture.
 */
export const googleProviderRuntime = google.runtime;

/** Bind a Google GenAI SDK client to the narrow native chat provider port. */
function bindGoogle(
  client: GoogleGenAI,
): NativeProviderPort<
  GoogleRequest,
  GenerateContentResponse,
  GoogleChatStream
> {
  return {
    call: (request, _mode, options) =>
      client.models.generateContent(
        asGoogleGenerateContentParams(
          withAbortSignal(request, options?.signal),
        ),
      ),
    stream: async (request, options) =>
      createGoogleStreamCapture(
        await client.models.generateContentStream(
          asGoogleGenerateContentStreamParams(
            withAbortSignal(request, options?.signal),
          ),
        ),
      ),
  };
}

/** Fold the caller's abort signal into Google's request config without mutating the caller's request. */
function withAbortSignal(
  request: GoogleRequest,
  signal: AbortSignal | undefined,
): GoogleRequest {
  if (signal === undefined) return request;
  return { ...request, config: { ...request.config, abortSignal: signal } };
}

/** Classify a Google GenAI SDK error into the normalized provider-error taxonomy. */
function mapGoogleError(error: unknown): CruxProviderError | undefined {
  return classifyProviderHttpError(error, "google");
}

/** Create a Google GenAI adapter bound to a client instance. */
export const createGoogle = google.create;

/** Lightweight helper factory generated from the Google provider runtime. */
export const googleHelpers = google.helpers();

function createGoogleRuntimeExtensions(client: GoogleGenAI): {
  retrievalModel(config: GoogleRetrievalModelConfig): RetrievalModel;
  reranker(config: GoogleRerankerConfig): Reranker;
} {
  const retrievalModel = (
    config: GoogleRetrievalModelConfig,
  ): RetrievalModel => {
    const generateText = googleHelpers.createGenerateTextFn(
      client,
      config.model,
    );
    const generateObject = googleHelpers.createGenerateObjectFn(client);
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
        generateObject(
          args.messages !== undefined
            ? {
                model: config.model,
                system: args.system,
                messages: args.messages,
                schema: args.schema,
                temperature: args.temperature,
                topP: args.topP,
              }
            : {
                model: config.model,
                system: args.system,
                prompt: args.prompt ?? "",
                schema: args.schema,
                temperature: args.temperature,
                topP: args.topP,
              },
        ),
    };
  };
  return {
    retrievalModel,
    reranker(config) {
      return judgeReranker({
        model: retrievalModel(config),
        name: config.name ?? "google-judge",
        topN: config.topN,
        document: config.document,
      });
    },
  };
}
