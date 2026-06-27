/**
 * Core type contracts for the Google CachedContent lifecycle.
 *
 * The lifecycle is the single boundary `googleRequest()` talks to. It hides
 * prefix planning, cache keying/eviction, SDK cache operations, and
 * fallback-versus-throw policy behind one `prepare()` call that returns a
 * request-ready Google system config patch.
 *
 * Branded types (`GoogleCacheName`, `CacheKey`) keep server resource names and
 * content hashes from being mixed up with arbitrary strings at compile time.
 *
 * @module
 */

import type { SystemBlock } from '@use-crux/core'

// ─────────────────────────────────────────────────────────────────
// Branded Types
// ─────────────────────────────────────────────────────────────────

/** Brand symbol for Google cache resource names. */
declare const CacheNameBrand: unique symbol

/**
 * Server-generated resource name for a Google CachedContent object.
 *
 * Branded to prevent accidentally passing arbitrary strings where a validated
 * cache name is expected.
 *
 * @example `"cachedContents/abc123def456"`
 */
export type GoogleCacheName = string & { readonly [CacheNameBrand]: true }

/** Brand symbol for content-derived cache keys. */
declare const CacheKeyBrand: unique symbol

/**
 * Deterministic hash key derived from `model + ttl + block texts`.
 *
 * Used for in-memory cache entry lookup — identical inputs always produce the
 * same key, so concurrent callers converge on one server-side cache object.
 */
export type CacheKey = string & { readonly [CacheKeyBrand]: true }

// ─────────────────────────────────────────────────────────────────
// Per-call controls
// ─────────────────────────────────────────────────────────────────

/**
 * Per-call CachedContent controls, supplied through `extra.cachedContent`.
 *
 * These options affect only the current request: `skip` forces a plain
 * `systemInstruction`, while `ttlSeconds` overrides the adapter-level default
 * TTL for a newly-created cache and participates in the local reuse key.
 */
export interface GoogleCachedContentCallOptions {
  /** Force-skip provider-level system prompt caching for this request. */
  readonly skip?: boolean
  /** TTL in seconds for a newly-created CachedContent object on this call. */
  readonly ttlSeconds?: number
}

// ─────────────────────────────────────────────────────────────────
// Prepare arguments + result plan
// ─────────────────────────────────────────────────────────────────

/** Inputs the lifecycle needs to plan one request's system config. */
export interface GoogleCachedContentPrepareArgs {
  /** Provider model id used by CachedContent creation. */
  readonly model: string
  /** Flat fallback system instruction from the resolved prompt. */
  readonly system?: string
  /** Structured system blocks carrying provider-neutral cache hints. */
  readonly systemBlocks?: readonly SystemBlock[]
  /** Per-call provider cache controls. */
  readonly call?: GoogleCachedContentCallOptions
}

/**
 * Reason a request fell back to an inline `systemInstruction` instead of a
 * server-side cache reference.
 *
 * - `'disabled'` — caching is turned off (`cache: false` or `enabled: false`).
 * - `'skipped'` — the call opted out via `cachedContent.skip`.
 * - `'no-cacheable-prefix'` — no leading `providerCache` system blocks.
 * - `'miss'` — the cache port returned no name (e.g. below Google's min tokens).
 * - `'fallback'` — a cache operation threw and `onError: 'fallback'` swallowed it.
 */
export type GoogleCachedContentInlineReason =
  | 'disabled'
  | 'skipped'
  | 'no-cacheable-prefix'
  | 'miss'
  | 'fallback'

/** A request served by a server-side CachedContent object. */
export interface GoogleCachedContentCachedPlan {
  readonly mode: 'cached'
  /** Google system config patch to merge into the request `config`. */
  readonly config: {
    /** Server-side CachedContent resource name for the cacheable prefix. */
    readonly cachedContent: GoogleCacheName
    /** Uncached system suffix sent inline alongside the cache reference. */
    readonly systemInstruction?: string
  }
  /** Diagnostic metadata about the resolved cache. */
  readonly meta?: {
    readonly ttlSeconds?: number
    readonly key?: CacheKey
    readonly reused?: boolean
  }
}

/** A request served entirely by an inline `systemInstruction`. */
export interface GoogleCachedContentInlinePlan {
  readonly mode: 'inline'
  /** Google system config patch to merge into the request `config`. */
  readonly config: {
    /** Plain system instruction text, when present. */
    readonly systemInstruction?: string
  }
  /** Why caching did not apply for this request. */
  readonly reason: GoogleCachedContentInlineReason
}

/**
 * The request-ready Google system config patch produced by the lifecycle.
 *
 * Discriminated on `mode`: `'cached'` carries a `cachedContent` reference,
 * `'inline'` carries only a plain `systemInstruction` plus a `reason`.
 */
export type GoogleCachedContentPlan = GoogleCachedContentCachedPlan | GoogleCachedContentInlinePlan

// ─────────────────────────────────────────────────────────────────
// Lifecycle boundary
// ─────────────────────────────────────────────────────────────────

/**
 * The single CachedContent boundary consumed by `googleRequest()`.
 *
 * Implementations own everything between the resolved system blocks and the
 * request config patch: prefix detection, cache keying and reuse, SDK cache
 * operations, and fallback policy. Request assembly only merges the returned
 * `config`.
 */
export interface GoogleCachedContentLifecycle {
  /** Plan one request's system config from resolved blocks and per-call options. */
  prepare(args: GoogleCachedContentPrepareArgs): Promise<GoogleCachedContentPlan>
  /** Optionally release any server-side caches this lifecycle created. */
  dispose?(): Promise<void>
}

// ─────────────────────────────────────────────────────────────────
// SDK cache port (true external boundary)
// ─────────────────────────────────────────────────────────────────

/**
 * The narrow external boundary for true Google CachedContent SDK operations.
 *
 * The built-in lifecycle drives all cache create/delete traffic through this
 * port, so tests can substitute an in-memory implementation instead of a
 * full `GoogleGenAI` client.
 */
export interface GoogleCachedContentCachePort {
  /**
   * Create a server-side cache for a cacheable system prefix.
   *
   * Returns the new cache's resource name, or `undefined` when the provider
   * declines to create one (for example, content below the minimum token
   * threshold).
   */
  create(input: {
    readonly model: string
    readonly systemInstruction: string
    readonly ttlSeconds: number
  }): Promise<GoogleCacheName | undefined>

  /** Delete a previously created server-side cache. */
  delete(input: { readonly name: GoogleCacheName }): Promise<void>
}
