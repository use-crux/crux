/**
 * `@crux/google` — Google GenAI SDK adapter.
 *
 * Built from the shared native chat provider helper in `@crux/core/adapter`.
 * Google-specific request params, function-call/function-response parts, and
 * CachedContent lifecycle remain owned by this package.
 *
 * @module
 */

export { createGoogle, buildGoogleSpec } from './native'
export type { CreateGoogleOptions } from './native'
export { createGenerateObjectFn, createGenerateTextFn } from './helpers'
export { embedding } from './embedding'
export { fromMessages, toMessages } from './message-codec'
export type { GoogleCacheConfig } from './cache-types'
export type { GoogleEmbeddingConfig, GoogleExtra, GoogleFunctionDeclaration, GoogleRequest } from './types'
