import type { Content, GenerateContentResponse, GoogleGenAI } from '@google/genai'
import { defineSingleTurnProviderBundle } from '@use-crux/core/adapter'
import type { NativeProviderPort, SingleTurnProviderBundleSpec } from '@use-crux/core/adapter'
import { judgeReranker, type Reranker, type RetrievalModel, type RetrieverHit } from '@use-crux/core/retrieval'
import { disabledCachedContentLifecycle, resolveCachedContentLifecycle } from './cached-content'
import type { GoogleCachedContentLifecycle, GoogleCachedContentOption } from './cached-content'
import { googleTranscript } from './message-codec'
import { googleMediaHooks } from './media-preflight'
import {
  asGoogleGenerateContentParams,
  asGoogleGenerateContentStreamParams,
  googleOutputSchema,
  googleRequest,
  googleSettings,
} from './request'
import { googleResponseMeta, googleResponseText } from './response'
import { googleTextDelta } from './stream'
import type { GoogleExtra, GoogleRequest } from './types'
import { createGoogleGenerateImage } from './image-generation'
import { createGoogleTranscribe } from './transcription'

/** Configuration for `google.retrievalModel()`. */
export interface GoogleRetrievalModelConfig {
  model: string
}

/** Configuration for `google.reranker()`. */
export interface GoogleRerankerConfig extends GoogleRetrievalModelConfig {
  name?: string
  topN?: number
  document?: (hit: RetrieverHit) => string
}

interface GoogleNativeDeps extends Record<string, unknown> {
  readonly cachedContentLifecycle?: GoogleCachedContentLifecycle
}

/**
 * Fallback lifecycle for the raw runtime when no deps are supplied.
 *
 * `createGoogle()` always injects a real lifecycle, so this only applies to
 * direct `googleProviderRuntime.create(client, {})` usage, where caching is off.
 */
const DISABLED_CACHED_CONTENT = disabledCachedContentLifecycle()

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
  readonly cachedContent?: GoogleCachedContentOption
}

/** Google single-turn provider bundle compiled by core. */
const google = defineSingleTurnProviderBundle({
  id: 'google',
  bind: bindGoogle,
  profile: {
    request: (args, { deps }) => googleRequest(args, deps.cachedContentLifecycle ?? DISABLED_CACHED_CONTENT),
    response: {
      meta: googleResponseMeta,
      text: googleResponseText,
    },
    stream: { textDelta: googleTextDelta },
    settings: googleSettings,
    outputSchema: googleOutputSchema,
    transcript: googleTranscript,
    media: googleMediaHooks,
  } satisfies SingleTurnProviderBundleSpec<
    GoogleGenAI,
    GoogleRequest,
    GenerateContentResponse,
    AsyncIterable<GenerateContentResponse>,
    GoogleExtra,
    GoogleNativeDeps,
    Content
  >['profile'],
  deps: {
    create: (client: GoogleGenAI, opts?: CreateGoogleOptions): GoogleNativeDeps => ({
      cachedContentLifecycle: resolveCachedContentLifecycle(client, opts?.cachedContent),
    }),
    // Lightweight helpers run plain text/object generation without system
    // blocks, so they leave caching off via the disabled fallback.
    helpers: (): GoogleNativeDeps => ({}),
  },
  extend: ({ client }) => createGoogleRuntimeExtensions(client),
})

/**
 * Public Google provider runtime.
 *
 * Google is a single-turn provider: the SDK exposes one generate-content call
 * or stream per turn, while Crux owns prompt resolution, tool loops,
 * validation retry, safety, observability, and memory capture.
 */
export const googleProviderRuntime = google.runtime

/** Bind a Google GenAI SDK client to the narrow native chat provider port. */
function bindGoogle(
  client: GoogleGenAI,
): NativeProviderPort<GoogleRequest, GenerateContentResponse, AsyncIterable<GenerateContentResponse>> {
  return {
    call: (request) => client.models.generateContent(asGoogleGenerateContentParams(request)),
    stream: (request) => client.models.generateContentStream(asGoogleGenerateContentStreamParams(request)),
  }
}

/** Create a Google GenAI adapter bound to a client instance. */
export const createGoogle = google.create

/** Lightweight helper factory generated from the Google provider runtime. */
export const googleHelpers = google.helpers()

function createGoogleRuntimeExtensions(client: GoogleGenAI): {
  generateImage: ReturnType<typeof createGoogleGenerateImage>
  transcribe: ReturnType<typeof createGoogleTranscribe>
  retrievalModel(config: GoogleRetrievalModelConfig): RetrievalModel
  reranker(config: GoogleRerankerConfig): Reranker
} {
  const retrievalModel = (config: GoogleRetrievalModelConfig): RetrievalModel => {
    const generateText = googleHelpers.createGenerateTextFn(client, config.model)
    const generateObject = googleHelpers.createGenerateObjectFn(client, config.model)
    return {
      generateText: (args) => generateText(
        args.messages
          ? { model: config.model, system: args.system, maxOutputTokens: args.maxOutputTokens, messages: args.messages }
          : { model: config.model, system: args.system, maxOutputTokens: args.maxOutputTokens, prompt: args.prompt ?? '' },
      ),
      generateObject: (args) => generateObject({ ...args, model: config.model }),
    }
  }
  return {
    generateImage: createGoogleGenerateImage(client),
    transcribe: createGoogleTranscribe(client),
    retrievalModel,
    reranker(config) {
      return judgeReranker({
        model: retrievalModel(config),
        name: config.name ?? 'google-judge',
        topN: config.topN,
        document: config.document,
      })
    },
  }
}
