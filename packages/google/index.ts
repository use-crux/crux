/**
 * `@use-crux/google` — Google GenAI SDK adapter.
 *
 * Built from the single-turn provider bundle in `@use-crux/core/adapter`.
 * Google-specific request params, function-call/function-response parts, and
 * CachedContent lifecycle remain owned by this package.
 *
 * @module
 */

export { createGoogle, googleProviderRuntime } from './native'
export type { CreateGoogleOptions } from './native'
export { createGenerateObjectFn, createGenerateTextFn } from './helpers'
export { embedding } from './embedding'
export { fromMessages, googleTranscript, toMessages } from './message-codec'
export type { GoogleAssistantTurn } from './message-codec'
export type {
  GoogleCachedContentCallOptions,
  GoogleCachedContentCreateOptions,
  GoogleCachedContentErrorMode,
  GoogleCachedContentOptions,
  GoogleCachedContentPort,
  GoogleCacheName,
} from './cache-types'
export type { GoogleEmbeddingConfig, GoogleExtra, GoogleFunctionDeclaration, GoogleRequest } from './types'
