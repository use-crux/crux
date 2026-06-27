import type { Content, GenerateContentResponse, GoogleGenAI } from '@google/genai'
import { adapter } from '@crux/core/adapter'
import type { AdapterSpec } from '@crux/core/adapter'
import { defineNativeChatProvider } from '@crux/core/adapter/native-chat'
import type { NativeProviderPort } from '@crux/core/adapter/native-chat'
import {
  disabledCachedContentLifecycle,
  resolveCachedContentLifecycle,
} from './cached-content'
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
  readonly cachedContentLifecycle: GoogleCachedContentLifecycle
}

/** Options for `createGoogle()`. */
export interface CreateGoogleOptions {
  /**
   * CachedContent configuration for Google's context caching API.
   *
   * - `undefined` / omitted: caching enabled with defaults
   * - `GoogleCacheConfig`: custom TTL, max entries, error mode, or cache port
   * - `false`: disable cache management entirely
   * - `GoogleCachedContentLifecycle`: a fully custom lifecycle implementation
   */
  readonly cache?: GoogleCachedContentOption
}

/** Google native chat profile compiled into the public Crux adapter API. */
const nativeGoogle = defineNativeChatProvider<
  GoogleRequest,
  GenerateContentResponse,
  AsyncIterable<GenerateContentResponse>,
  GoogleExtra,
  GoogleNativeDeps,
  Content
>({
  providerId: 'google',
  request: (args, { deps }) => googleRequest(args, deps.cachedContentLifecycle),
  response: {
    meta: googleResponseMeta,
    text: googleResponseText,
  },
  stream: { textDelta: googleTextDelta },
  settings: googleSettings,
  outputSchema: googleOutputSchema,
  transcript: googleTranscript,
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

/** Build the native Google `AdapterSpec`, closing over a CachedContent lifecycle. */
export function buildGoogleSpec(
  cachedContentLifecycle: GoogleCachedContentLifecycle,
): AdapterSpec<GoogleGenAI, GenerateContentResponse, AsyncIterable<GenerateContentResponse>, GoogleExtra> {
  return nativeGoogle.specFor(bindGoogle, { cachedContentLifecycle })
}

/** Create a Google GenAI adapter bound to a client instance. */
export function createGoogle(client: GoogleGenAI, opts?: CreateGoogleOptions) {
  const cachedContentLifecycle = resolveCachedContentLifecycle(client, opts?.cache)

  return adapter(buildGoogleSpec(cachedContentLifecycle))(client)
}

/**
 * Lightweight helper factory generated from the Google native chat profile.
 *
 * Helpers run plain text/object generation without system blocks, so they use a
 * disabled CachedContent lifecycle and never create server-side caches.
 */
export const googleHelpers = nativeGoogle.helpers(bindGoogle, {
  cachedContentLifecycle: disabledCachedContentLifecycle(),
})
