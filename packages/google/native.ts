import type { GenerateContentResponse, GoogleGenAI } from '@google/genai'
import { adapter } from '@crux/core/adapter'
import type { AdapterSpec } from '@crux/core/adapter'
import { defineNativeChatProvider } from '@crux/core/adapter/native-chat'
import type { NativeProviderPort } from '@crux/core/adapter/native-chat'
import { GoogleCacheManager } from './cache-manager'
import type { GoogleCacheConfig } from './cache-types'
import { resolveCacheConfig } from './cache-types'
import { fromMessages, toMessages } from './message-codec'
import {
  asGoogleGenerateContentParams,
  asGoogleGenerateContentStreamParams,
  googleOutputSchema,
  googleRequest,
  googleSettings,
} from './request'
import { googleResponse } from './response'
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

/** Google native chat profile compiled into the public Crux adapter API. */
const nativeGoogle = defineNativeChatProvider<
  GoogleRequest,
  GenerateContentResponse,
  AsyncIterable<GenerateContentResponse>,
  GoogleExtra,
  GoogleNativeDeps
>({
  providerId: 'google',
  request: (args, { deps }) => googleRequest(args, deps.cacheManager),
  response: googleResponse,
  stream: { textDelta: googleTextDelta },
  settings: googleSettings,
  outputSchema: googleOutputSchema,
  messages: {
    fromCrux: fromMessages,
    toCrux: toMessages,
  },
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

/** Build the native Google `AdapterSpec`, closing over an optional cache manager. */
export function buildGoogleSpec(
  cacheManager?: GoogleCacheManager,
): AdapterSpec<GoogleGenAI, GenerateContentResponse, AsyncIterable<GenerateContentResponse>, GoogleExtra> {
  return nativeGoogle.specFor(bindGoogle, { cacheManager })
}

/** Create a Google GenAI adapter bound to a client instance. */
export function createGoogle(client: GoogleGenAI, opts?: CreateGoogleOptions) {
  const cacheManager =
    opts?.cache !== false ? new GoogleCacheManager(client, resolveCacheConfig(opts?.cache)) : undefined

  return adapter(buildGoogleSpec(cacheManager))(client)
}

/** Lightweight helper factory generated from the Google native chat profile. */
export const googleHelpers = nativeGoogle.helpers(bindGoogle, {})
