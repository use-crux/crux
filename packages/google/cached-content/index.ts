/**
 * Google CachedContent lifecycle — public surface.
 *
 * `googleRequest()` depends only on {@link GoogleCachedContentLifecycle};
 * `createGoogle()` constructs one via {@link resolveCachedContentLifecycle}.
 * Everything between (planner, store, SDK port, fallback policy) is an
 * implementation detail of the built-in lifecycle.
 *
 * @module
 */

export type {
  GoogleCacheConfig,
  GoogleCachedContentErrorMode,
  ResolvedCacheConfig,
} from './config'
export { CACHE_DEFAULTS, resolveCacheConfig } from './config'

export { disabledCachedContentLifecycle, resolveCachedContentLifecycle } from './resolve-lifecycle'
export type { GoogleCachedContentOption } from './resolve-lifecycle'

export { createBuiltInCachedContentLifecycle } from './built-in-lifecycle'

export type {
  CacheKey,
  GoogleCacheName,
  GoogleCachedContentCachePort,
  GoogleCachedContentCallOptions,
  GoogleCachedContentCachedPlan,
  GoogleCachedContentInlinePlan,
  GoogleCachedContentInlineReason,
  GoogleCachedContentLifecycle,
  GoogleCachedContentPlan,
  GoogleCachedContentPrepareArgs,
} from './types'
