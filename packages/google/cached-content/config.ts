/**
 * Public configuration for the Google CachedContent lifecycle.
 *
 * `GoogleCacheConfig` is the user-facing shape accepted by `createGoogle()`.
 * `ResolvedCacheConfig` is the fully-defaulted value config the built-in
 * lifecycle runs against. The `port` override lives here because it is supplied
 * alongside the other tuning knobs, but it is threaded out separately as a
 * dependency rather than a plain value.
 *
 * @module
 */

import type { GoogleCachedContentCachePort } from './types'

/**
 * Behavior when a CachedContent SDK operation throws.
 *
 * - `'fallback'` — swallow the error and send a plain `systemInstruction`
 *   (caching is an optimization, generation continues). This is the default.
 * - `'throw'` — surface the error to the caller so cache failures are loud.
 */
export type GoogleCachedContentErrorMode = 'fallback' | 'throw'

/**
 * User-facing cache configuration for the Google adapter.
 *
 * Passed as `createGoogle(client, { cache })`. Omit for defaults, pass `false`
 * to disable, or pass a {@link GoogleCachedContentLifecycle} to take full
 * control of the lifecycle.
 *
 * @example
 * ```ts
 * const google = createGoogle(client, {
 *   cache: { defaultTtlSeconds: 600, maxEntries: 100, onError: 'throw' },
 * })
 * ```
 */
export interface GoogleCacheConfig {
  /**
   * Enable or disable cache management.
   *
   * When `true`, caching activates automatically once leading `systemBlocks`
   * carry `providerCache: true`.
   *
   * @defaultValue `true`
   */
  enabled?: boolean

  /**
   * Default TTL in seconds for new server-side cache objects.
   *
   * Matches Anthropic's 5-minute cache window by default.
   *
   * @defaultValue `300`
   */
  defaultTtlSeconds?: number

  /**
   * Maximum number of concurrent cache entries to track in memory.
   *
   * Oldest entries are evicted once this limit is exceeded.
   *
   * @defaultValue `50`
   */
  maxEntries?: number

  /**
   * What to do when a cache create/delete operation throws.
   *
   * @defaultValue `'fallback'`
   */
  onError?: GoogleCachedContentErrorMode

  /**
   * Override the SDK cache boundary used for create/delete operations.
   *
   * Supply a custom {@link GoogleCachedContentCachePort} to back caching with
   * something other than the bound `GoogleGenAI` client (for example a fake in
   * tests, or a shared cache service). Local keying, TTL, dedupe, and eviction
   * are still handled by the built-in lifecycle.
   */
  port?: GoogleCachedContentCachePort
}

/** Fully-resolved value config with all defaults applied. */
export interface ResolvedCacheConfig {
  readonly enabled: boolean
  readonly defaultTtlSeconds: number
  readonly maxEntries: number
  readonly onError: GoogleCachedContentErrorMode
}

/** Default cache configuration values. */
export const CACHE_DEFAULTS = {
  enabled: true,
  defaultTtlSeconds: 300,
  maxEntries: 50,
  onError: 'fallback',
} as const satisfies ResolvedCacheConfig

/** Resolve user config into a fully-defaulted value config. */
export function resolveCacheConfig(config?: GoogleCacheConfig): ResolvedCacheConfig {
  return {
    enabled: config?.enabled ?? CACHE_DEFAULTS.enabled,
    defaultTtlSeconds: config?.defaultTtlSeconds ?? CACHE_DEFAULTS.defaultTtlSeconds,
    maxEntries: config?.maxEntries ?? CACHE_DEFAULTS.maxEntries,
    onError: config?.onError ?? CACHE_DEFAULTS.onError,
  }
}
