/**
 * Type definitions for Google CachedContent API integration.
 *
 * Uses branded types for compile-time safety and discriminated unions
 * for type-safe cache entry lifecycle management.
 *
 * @module
 */

import type { SystemBlock } from '@crux/core'

// ─────────────────────────────────────────────────────────────────
// Branded Types
// ─────────────────────────────────────────────────────────────────

/** Brand symbol for Google cache resource names. */
declare const CacheNameBrand: unique symbol

/**
 * Server-generated resource name for a Google CachedContent object.
 *
 * Branded to prevent accidentally passing arbitrary strings where
 * a validated cache name is expected.
 *
 * @example `"cachedContents/abc123def456"`
 */
export type GoogleCacheName = string & { readonly [CacheNameBrand]: true }

/** Brand symbol for content-derived cache keys. */
declare const CacheKeyBrand: unique symbol

/**
 * Deterministic hash key derived from `model + block texts`.
 *
 * Used for cache entry lookup — same content always produces the same key.
 */
export type CacheKey = string & { readonly [CacheKeyBrand]: true }

// ─────────────────────────────────────────────────────────────────
// Cache Entry States (discriminated union)
// ─────────────────────────────────────────────────────────────────

/** An active cache entry that can be referenced in generation calls. */
export interface ActiveCacheEntry {
  readonly status: 'active'
  readonly name: GoogleCacheName
  readonly key: CacheKey
  readonly expiresAt: number
  readonly model: string
}

/** A cache entry currently being created (used for concurrency dedup). */
export interface CreatingCacheEntry {
  readonly status: 'creating'
  readonly key: CacheKey
  readonly promise: Promise<ActiveCacheEntry | undefined>
}

/**
 * Discriminated union representing cache entry lifecycle states.
 *
 * - `'active'`: Cache exists server-side and can be referenced
 * - `'creating'`: Cache creation in-flight (concurrent callers await the promise)
 */
export type CacheEntry = ActiveCacheEntry | CreatingCacheEntry

/** Per-resolution cache controls supplied by Google request planning. */
export interface GoogleCacheResolveOptions {
  /**
   * TTL in seconds for a newly-created CachedContent object.
   * Omit to use the adapter-level default TTL.
   */
  readonly ttlSeconds?: number
}

// ─────────────────────────────────────────────────────────────────
// Type Guards
// ─────────────────────────────────────────────────────────────────

/** Narrow a `CacheEntry` to `ActiveCacheEntry`. */
export function isActiveCacheEntry(entry: CacheEntry): entry is ActiveCacheEntry {
  return entry.status === 'active'
}

/** Narrow a `CacheEntry` to `CreatingCacheEntry`. */
export function isCreatingCacheEntry(entry: CacheEntry): entry is CreatingCacheEntry {
  return entry.status === 'creating'
}

// ─────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────

/** Error handling strategy for Google CachedContent creation failures. */
export type GoogleCachedContentErrorMode = 'fallback' | 'throw'

/**
 * Configure Google's CachedContent integration for `createGoogle()`.
 *
 * Pass this as `cachedContent` in `CreateGoogleOptions`. CachedContent remains
 * a Google-provider feature: Crux core only supplies provider-neutral
 * `SystemBlock.providerCache` hints, while this package owns cache creation,
 * reuse, expiry, and fallback behavior.
 *
 * @example
 * ```ts
 * const google = createGoogle(client, {
 *   cachedContent: { defaultTtlSeconds: 600, maxEntries: 100 },
 * })
 * ```
 */
export interface GoogleCachedContentOptions {
  /**
   * Enable or disable cache management.
   * When `true`, caching activates automatically when `systemBlocks`
   * contain blocks with `providerCache: true`.
   * @default true
   */
  enabled?: boolean

  /**
   * Default TTL in seconds for new server-side cache objects.
   * Matches Anthropic's 5-minute cache window by default.
   * @default 300
   */
  defaultTtlSeconds?: number

  /**
   * Maximum number of concurrent cache entries to track in memory.
   * Oldest entries are evicted when this limit is exceeded.
   * @default 50
   */
  maxEntries?: number

  /**
   * How to handle Google CachedContent API failures.
   *
   * - `'fallback'`: send the full system prompt inline and continue.
   * - `'throw'`: reject the generation/stream request with the original error.
   *
   * @default 'fallback'
   */
  onError?: GoogleCachedContentErrorMode
}

/** Per-call CachedContent controls accepted in `GoogleExtra.cachedContent`. */
export interface GoogleCachedContentCallOptions {
  /** Skip Google CachedContent for this request and send system text inline. */
  readonly skip?: boolean
  /** TTL in seconds for this request's Google CachedContent object. */
  readonly ttlSeconds?: number
}

/**
 * User-supplied CachedContent boundary for advanced adapter customization.
 *
 * A custom port can replace the built-in in-memory cache manager while keeping
 * request planning inside `@crux/google`. Returning `undefined` tells the
 * adapter to fall back to an inline `systemInstruction`.
 */
export interface GoogleCachedContentPort {
  /** Resolve a Google CachedContent resource for a cacheable system prefix. */
  resolve(args: {
    /** Google model id for the current request. */
    readonly model: string
    /** Leading system blocks marked with `providerCache: true`. */
    readonly blocks: readonly SystemBlock[]
    /** Per-call TTL override, when provided by `extra.cachedContent`. */
    readonly ttlSeconds?: number
  }): Promise<GoogleCacheName | undefined>

  /** Optional cleanup hook for custom cache resources. */
  dispose?(): Promise<void>
}

/** Accepted values for `CreateGoogleOptions.cachedContent`. */
export type GoogleCachedContentCreateOptions = false | GoogleCachedContentOptions | GoogleCachedContentPort

/** Fully resolved cache config with all defaults applied. */
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

/** Resolve user config with defaults. */
export function resolveCacheConfig(config?: GoogleCachedContentOptions): ResolvedCacheConfig {
  return {
    enabled: config?.enabled ?? CACHE_DEFAULTS.enabled,
    defaultTtlSeconds: config?.defaultTtlSeconds ?? CACHE_DEFAULTS.defaultTtlSeconds,
    maxEntries: config?.maxEntries ?? CACHE_DEFAULTS.maxEntries,
    onError: config?.onError ?? CACHE_DEFAULTS.onError,
  }
}
