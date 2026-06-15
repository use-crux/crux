/**
 * Google CachedContent lifecycle manager.
 *
 * Manages server-side cache objects for Google's context caching API.
 * Handles creation, reuse, concurrency deduplication, TTL, and graceful
 * error fallback.
 *
 * @module
 */

import { createHash } from 'node:crypto'
import type { GoogleGenAI } from '@google/genai'
import type { SystemBlock } from '@crux/core'
import type {
  GoogleCacheName,
  CacheKey,
  CacheEntry,
  ActiveCacheEntry,
  ResolvedCacheConfig,
  GoogleCacheResolveOptions,
} from './cache-types'

export class GoogleCacheManager {
  private readonly entries = new Map<CacheKey, CacheEntry>()

  constructor(
    private readonly client: GoogleGenAI,
    private readonly config: ResolvedCacheConfig,
  ) {}

  /**
   * Compute a deterministic cache key from model, TTL, and block texts.
   *
   * Order matters — Google requires cached content to be a stable prefix.
   * TTL matters too because two requests may need independently-expiring
   * server-side cache objects for the same text.
   *
   * Uses SHA-256 via `node:crypto` (sync).
   */
  computeKey(model: string, texts: readonly string[], options?: GoogleCacheResolveOptions): CacheKey {
    const ttlSeconds = this.resolveTtlSeconds(options)
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
   * Resolve a cache name for the given model and system blocks.
   *
   * Returns the `GoogleCacheName` to pass as `config.cachedContent`
   * in `generateContent()`, or `undefined` if caching is not applicable
   * (no cacheable blocks, disabled, or error fallback).
   */
  async resolve(
    model: string,
    blocks: readonly SystemBlock[],
    options?: GoogleCacheResolveOptions,
  ): Promise<GoogleCacheName | undefined> {
    if (!this.config.enabled) return undefined

    const cacheableBlocks = blocks.filter((b) => b.providerCache)
    if (cacheableBlocks.length === 0) return undefined

    const texts = cacheableBlocks.map((b) => b.text)
    const ttlSeconds = this.resolveTtlSeconds(options)
    const key = this.computeKey(model, texts, { ttlSeconds })

    // Check for existing entry
    const existing = this.entries.get(key)
    if (existing) {
      if (existing.status === 'creating') {
        const resolved = await existing.promise
        return resolved?.name
      }
      if (existing.status === 'active' && existing.expiresAt > Date.now()) {
        return existing.name
      }
      // Expired — remove and fall through to create
      this.entries.delete(key)
    }

    // Create new cache with concurrency dedup
    const promise = this.createCache(model, key, texts, ttlSeconds)
    this.entries.set(key, { status: 'creating', key, promise })

    const entry = await promise
    return entry?.name
  }

  /** Create a server-side cache and store the active entry. */
  private async createCache(
    model: string,
    key: CacheKey,
    texts: readonly string[],
    ttlSeconds: number,
  ): Promise<ActiveCacheEntry | undefined> {
    try {
      const systemInstruction = texts.join('\n\n')

      const cached = await this.client.caches.create({
        model,
        config: {
          systemInstruction,
          ttl: `${ttlSeconds}s`,
        },
      })

      if (!cached.name) {
        this.entries.delete(key)
        return undefined
      }

      const entry: ActiveCacheEntry = {
        status: 'active',
        name: cached.name as GoogleCacheName,
        key,
        expiresAt: Date.now() + ttlSeconds * 1000,
        model,
      }
      this.entries.set(key, entry)
      this.evict()
      return entry
    } catch {
      console.warn('[crux-google] Cache creation failed, falling back to uncached.')
      this.entries.delete(key)
      return undefined
    }
  }

  private resolveTtlSeconds(options: GoogleCacheResolveOptions | undefined): number {
    return options?.ttlSeconds ?? this.config.defaultTtlSeconds
  }

  /** Evict oldest entries when maxEntries is exceeded. */
  private evict(): void {
    if (this.entries.size <= this.config.maxEntries) return

    // Remove expired first
    const now = Date.now()
    for (const [key, entry] of this.entries) {
      if (entry.status === 'active' && entry.expiresAt <= now) {
        this.entries.delete(key)
      }
    }

    // If still over limit, remove oldest active entries
    while (this.entries.size > this.config.maxEntries) {
      const firstKey = this.entries.keys().next().value
      if (firstKey !== undefined) {
        this.entries.delete(firstKey)
      } else {
        break
      }
    }
  }

  /**
   * Delete all tracked server-side caches.
   * Call this for explicit cleanup. Caches also expire via TTL naturally.
   */
  async dispose(): Promise<void> {
    const deletePromises: Promise<unknown>[] = []
    for (const entry of this.entries.values()) {
      if (entry.status === 'active') {
        deletePromises.push(
          this.client.caches.delete({ name: entry.name }).catch(() => {
            // Ignore delete failures — cache may have already expired
          }),
        )
      }
    }
    await Promise.allSettled(deletePromises)
    this.entries.clear()
  }
}
