import type { Content, GenerateContentResponse, GoogleGenAI } from '@google/genai'
import { defineAdapterProfile, nativeChat } from '@crux/core/adapter/profile'
import type { NativeChatProfile, NativeProviderPort } from '@crux/core/adapter/profile'
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

/** Google provider hooks shared by the public profile and lightweight helpers. */
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
  NativeChatProfile<
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

/** Google profile hooks including the client binder. */
const googleProfileHooks = {
  bind: bindGoogle,
  ...googleProviderHooks,
} satisfies NativeChatProfile<
  GoogleGenAI,
  GoogleRequest,
  GenerateContentResponse,
  AsyncIterable<GenerateContentResponse>,
  GoogleExtra,
  GoogleNativeDeps,
  Content
>

const googleNativeDriver = nativeChat(googleProfileHooks)

/** Public Google adapter profile. */
export const googleProfile = defineAdapterProfile({
  id: 'google',
  driver: googleNativeDriver,
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

  return googleProfile.create(client, { cacheManager })
}

/** Lightweight helper factory generated from the Google native chat profile. */
export const googleHelpers = googleNativeDriver.helpers('google', {})
