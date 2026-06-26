import type { Content, GenerateContentResponse, GoogleGenAI } from '@google/genai'
import { defineProviderRuntime } from '@use-crux/core/adapter'
import type { NativeProviderPort, SingleTurnRuntimeContract } from '@use-crux/core/adapter'
import { GoogleCacheManager } from './cache-manager'
import type { GoogleCachedContentCreateOptions, GoogleCachedContentPort } from './cache-types'
import { resolveCacheConfig } from './cache-types'
import { googleTranscript } from './message-codec'
import {
  asGoogleGenerateContentParams,
  asGoogleGenerateContentStreamParams,
  googleOutputSchema,
  googleRequest,
  googleSettings,
} from './request'
import { googleResponseMeta, googleResponseText } from './response'
import { googleTextDelta } from './stream'
import type { GoogleSystemCacheResolver } from './system-cache-planner'
import type { GoogleExtra, GoogleRequest } from './types'

interface GoogleNativeDeps extends Record<string, unknown> {
  readonly cacheResolver?: GoogleSystemCacheResolver
}

/** Options for `createGoogle()`. */
export interface CreateGoogleOptions {
  /**
   * Configure Google's CachedContent API integration.
   *
   * - `undefined` / omitted: caching enabled with defaults
   * - `GoogleCachedContentOptions`: use the built-in in-memory cache manager
   * - `GoogleCachedContentPort`: provide a custom cache resolver
   * - `false`: disable CachedContent management entirely
   */
  readonly cachedContent?: GoogleCachedContentCreateOptions
}

/** Google provider hooks shared by the public runtime and lightweight helpers. */
const googleProviderHooks = {
  request: (args, { deps }) => googleRequest(args, deps.cacheResolver),
  response: {
    meta: googleResponseMeta,
    text: googleResponseText,
  },
  stream: { textDelta: googleTextDelta },
  settings: googleSettings,
  outputSchema: googleOutputSchema,
  transcript: googleTranscript,
} satisfies Omit<
  SingleTurnRuntimeContract<
    GoogleGenAI,
    GoogleRequest,
    GenerateContentResponse,
    AsyncIterable<GenerateContentResponse>,
    GoogleExtra,
    GoogleNativeDeps,
    Content
  >,
  'bind'
>

/** Google runtime hooks including the client binder. */
const googleRuntimeHooks = {
  bind: bindGoogle,
  ...googleProviderHooks,
} satisfies SingleTurnRuntimeContract<
  GoogleGenAI,
  GoogleRequest,
  GenerateContentResponse,
  AsyncIterable<GenerateContentResponse>,
  GoogleExtra,
  GoogleNativeDeps,
  Content
>

/**
 * Public Google provider runtime.
 *
 * Google is a single-turn provider: the SDK exposes one generate-content call
 * or stream per turn, while Crux owns prompt resolution, tool loops,
 * validation retry, safety, observability, and memory capture.
 */
export const googleProviderRuntime = defineProviderRuntime({
  id: 'google',
  ownership: 'single-turn',
  turn: googleRuntimeHooks,
})

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
export function createGoogle(client: GoogleGenAI, opts?: CreateGoogleOptions) {
  const cacheResolver = createGoogleCachedContentResolver(client, opts)

  return googleProviderRuntime.create(client, { cacheResolver })
}

/** Lightweight helper factory generated from the Google provider runtime. */
export const googleHelpers = googleProviderRuntime.helpers({})

function createGoogleCachedContentResolver(
  client: GoogleGenAI,
  opts: CreateGoogleOptions | undefined,
): GoogleSystemCacheResolver | undefined {
  const cachedContent = opts?.cachedContent
  if (cachedContent === false) return undefined
  if (isGoogleCachedContentPort(cachedContent)) {
    return {
      resolve: (model, blocks, options) =>
        cachedContent.resolve({
          model,
          blocks,
          ...(options?.ttlSeconds === undefined ? {} : { ttlSeconds: options.ttlSeconds }),
        }),
    }
  }
  return new GoogleCacheManager(client, resolveCacheConfig(cachedContent))
}

function isGoogleCachedContentPort(
  value: GoogleCachedContentCreateOptions | undefined,
): value is GoogleCachedContentPort {
  return typeof value === 'object' && value !== null && 'resolve' in value && typeof value.resolve === 'function'
}
