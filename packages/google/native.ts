import type { Content, GenerateContentResponse, GoogleGenAI } from '@google/genai'
import { defineSingleTurnProviderBundle } from '@use-crux/core/adapter'
import type { NativeProviderPort, SingleTurnProviderBundleSpec } from '@use-crux/core/adapter'
import { disabledCachedContentLifecycle, resolveCachedContentLifecycle } from './cached-content'
import type { GoogleCachedContentLifecycle, GoogleCachedContentOption } from './cached-content'
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
