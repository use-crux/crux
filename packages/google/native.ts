import type { Content, GenerateContentResponse, GoogleGenAI } from '@google/genai'
import { defineProviderRuntime } from '@crux/core/adapter'
import type { NativeProviderPort, SingleTurnRuntimeContract } from '@crux/core/adapter'
import { GoogleCacheManager } from './cache-manager'
import type { GoogleCacheConfig } from './cache-types'
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
import type { GoogleExtra, GoogleRequest } from './types'

interface GoogleNativeDeps extends Record<string, unknown> {
  readonly cacheManager?: GoogleCacheManager
}

/** Options for `createGoogle()`. */
export interface CreateGoogleOptions {
  /**
   * Cache configuration for Google's CachedContent API.
   *
   * - `undefined` / omitted: caching enabled with defaults
   * - `GoogleCacheConfig`: custom TTL, max entries, etc.
   * - `false`: disable cache management entirely
   */
  readonly cache?: GoogleCacheConfig | false
}

/** Google provider hooks shared by the public runtime and lightweight helpers. */
const googleProviderHooks = {
  request: (args, { deps }) => googleRequest(args, deps.cacheManager),
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
  const cacheManager =
    opts?.cache !== false ? new GoogleCacheManager(client, resolveCacheConfig(opts?.cache)) : undefined

  return googleProviderRuntime.create(client, { cacheManager })
}

/** Lightweight helper factory generated from the Google provider runtime. */
export const googleHelpers = googleProviderRuntime.helpers({})
