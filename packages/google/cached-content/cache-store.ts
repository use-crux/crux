/**
 * In-memory cache store for Google CachedContent objects.
 *
 * Owns the local bookkeeping around server-side caches: deterministic keying,
 * TTL-based expiry, in-flight create deduplication, max-entry eviction, and
 * bulk dispose. All true external operations go through a
 * {@link GoogleCachedContentCachePort}, so the store has no `@google/genai`
 * dependency and is fully exercisable with an in-memory port.
 *
 * Errors from the port are intentionally **not** swallowed — the lifecycle owns
 * fallback-versus-throw policy. The store only guarantees that a failed create
 * leaves no stale entry behind, so the next resolve retries cleanly.
 *
 * @module
 */

import { createHash } from 'node:crypto'
import type { CacheKey, GoogleCacheName, GoogleCachedContentCachePort } from './types'

/** Tuning knobs the store needs, independent of the public config shape. */
export interface CacheStoreConfig {
  /** Fallback TTL when a resolve does not specify one. */
  readonly defaultTtlSeconds: number
  /** Maximum number of tracked entries before eviction kicks in. */
  readonly maxEntries: number
}

/** Inputs for a single cache resolution. */
export interface CacheResolveInput {
  /** Provider model id used by CachedContent creation. */
  readonly model: string
  /** Cacheable prefix block texts, in stable order. */
  readonly texts: readonly string[]
  /** TTL in seconds for a newly-created cache and the local reuse key. */
  readonly ttlSeconds: number
}

/** Successful resolution of a server-side cache. */
export interface CacheResolution {
  /** Server-side CachedContent resource name. */
  readonly name: GoogleCacheName
  /** Deterministic key the entry is tracked under. */
  readonly key: CacheKey
  /** Whether an existing (active or in-flight) entry served this resolve. */
  readonly reused: boolean
}

/** An active cache entry that can be referenced in generation calls. */
interface ActiveCacheEntry {
  readonly status: 'active'
  readonly name: GoogleCacheName
  readonly expiresAt: number
}

/** A cache entry whose creation is in flight (used for concurrency dedupe). */
interface CreatingCacheEntry {
  readonly status: 'creating'
  readonly promise: Promise<ActiveCacheEntry | undefined>
}

type CacheEntry = ActiveCacheEntry | CreatingCacheEntry

export class GoogleCachedContentStore {
  private readonly entries = new Map<CacheKey, CacheEntry>()

  constructor(
    private readonly port: GoogleCachedContentCachePort,
    private readonly config: CacheStoreConfig,
  ) {}

  /**
   * Compute a deterministic key from model, TTL, and ordered block texts.
   *
   * Order matters because Google requires cached content to be a stable prefix.
   * TTL is folded in so two callers wanting independently-expiring caches for
   * the same text do not collide. Uses SHA-256 via `node:crypto`.
   */
  computeKey(model: string, texts: readonly string[], ttlSeconds: number): CacheKey {
    const hash = createHash('sha256')
    hash.update(model)
    hash.update('\0')
    hash.update(String(ttlSeconds))
    hash.update('\0')
    for (const text of texts) {
      hash.update(text)
      hash.update('\0')
    }
    return hash.digest('hex') as CacheKey
  }

  /**
   * Resolve a server-side cache name for the given prefix.
   *
   * Reuses a live or in-flight entry when possible, otherwise creates a new
   * cache through the port. Returns `undefined` when the port declines to
   * create one; throws when the port throws.
   */
  async resolve(input: CacheResolveInput): Promise<CacheResolution | undefined> {
    const key = this.computeKey(input.model, input.texts, input.ttlSeconds)

    const existing = this.entries.get(key)
    if (existing) {
      if (existing.status === 'creating') {
        const resolved = await existing.promise
        return resolved ? { name: resolved.name, key, reused: true } : undefined
      }
      if (existing.expiresAt > Date.now()) {
        return { name: existing.name, key, reused: true }
      }
      this.entries.delete(key)
    }

    const promise = this.createEntry(input, key)
    this.entries.set(key, { status: 'creating', promise })

    const entry = await promise
    return entry ? { name: entry.name, key, reused: false } : undefined
  }

  /** Create a server-side cache through the port and store the active entry. */
  private async createEntry(input: CacheResolveInput, key: CacheKey): Promise<ActiveCacheEntry | undefined> {
    try {
      const name = await this.port.create({
        model: input.model,
        systemInstruction: input.texts.join('\n\n'),
        ttlSeconds: input.ttlSeconds,
      })
      if (!name) {
        this.entries.delete(key)
        return undefined
      }

      const entry: ActiveCacheEntry = {
        status: 'active',
        name,
        expiresAt: Date.now() + input.ttlSeconds * 1000,
      }
      this.entries.set(key, entry)
      this.evict()
      return entry
    } catch (error) {
      // Leave no stale entry behind, then let the lifecycle apply its policy.
      this.entries.delete(key)
      throw error
    }
  }

  /** Evict expired-then-oldest entries once the tracking map exceeds capacity. */
  private evict(): void {
    if (this.entries.size <= this.config.maxEntries) return

    const now = Date.now()
    for (const [key, entry] of this.entries) {
      if (entry.status === 'active' && entry.expiresAt <= now) {
        this.entries.delete(key)
      }
    }

    while (this.entries.size > this.config.maxEntries) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
  }

  /**
   * Delete every tracked server-side cache and clear local state.
   *
   * Delete failures are ignored — a cache may have already expired server-side.
   */
  async dispose(): Promise<void> {
    const deletions: Promise<unknown>[] = []
    for (const entry of this.entries.values()) {
      if (entry.status === 'active') {
        deletions.push(this.port.delete({ name: entry.name }).catch(() => undefined))
      }
    }
    await Promise.allSettled(deletions)
    this.entries.clear()
  }
}
