/**
 * Redis-backed CruxStore using `@upstash/redis`.
 *
 * Stores documents as JSON strings in Redis keys with a configurable prefix.
 * Change notifications via Redis `PUBLISH`/`SUBSCRIBE` on an events channel.
 *
 * @module
 */

import type {
  CruxStore,
  JsonObject,
  ListOptions,
  ListResult,
  ScoredEntry,
  SetOptions,
  StoreEntry,
  StoreEvent,
  VectorSearchOptions,
  VectorSearchQuery,
} from '@crux/core/store'
import { matchesFilter } from '@crux/core/store'

/**
 * Minimal Redis client interface compatible with `@upstash/redis`.
 * Only the methods actually used by `cruxRedisStore`.
 */
export interface RedisClient {
  get<T = string | JsonObject>(key: string): Promise<T | null>
  set(key: string, value: string, opts?: { px?: number }): Promise<unknown>
  del(...keys: string[]): Promise<number>
  keys(pattern: string): Promise<string[]>
  publish(channel: string, message: string): Promise<number>
}

/**
 * Minimal Redis subscriber interface for `SUBSCRIBE`.
 */
export interface RedisSubscriber {
  subscribe<T = string>(channel: string, callback: (message: T) => void): Promise<void>
  unsubscribe(channel: string): Promise<void>
}

export interface RedisVectorSearchResult {
  key: string
  score: number
  value?: JsonObject
}

export interface RedisVectorHooks {
  /**
   * Called after every `set()`. Implement this with Redis Stack/RediSearch,
   * a managed Redis vector extension, or any sidecar vector index.
   */
  upsert?: (entry: { key: string; redisKey: string; value: JsonObject }) => Promise<void>
  /** Called after every `delete()`. */
  delete?: (entry: { key: string; redisKey: string }) => Promise<void>
  /**
   * Product-specific vector search implementation. Return values may include
   * hydrated `value`; if omitted, Crux loads the JSON value by key.
   */
  searchVectors: (
    query: VectorSearchQuery,
    helpers: {
      prefix: string
      redisKey: (key: string) => string
      getValue: (key: string) => Promise<JsonObject | null>
    },
  ) => Promise<RedisVectorSearchResult[]>
  capabilities?: {
    dense?: boolean
    sparse?: boolean
    hybrid?: boolean
  }
  /** Set true only when the vector index/namespace is dedicated to semantic-cache entries. */
  semanticCache?: {
    isolatedVectorNamespace?: boolean
  }
}

/**
 * Configuration for `cruxRedisStore`.
 */
export interface CruxRedisStoreConfig {
  /** The Redis client instance (e.g., `new Redis({ url, token })`). */
  redis: RedisClient
  /**
   * Key prefix for all CruxStore entries.
   * Default: `'crux:'`.
   *
   * @example `'crux:'` → keys like `crux:plan:abc`, `crux:tasklist:xyz`
   */
  prefix?: string
  /**
   * Optional Redis subscriber for real-time change notifications.
   * If provided, `subscribe()` is available on the returned store.
   *
   * For Upstash REST Redis, you typically need a separate connection for subscriptions.
   */
  subscriber?: RedisSubscriber
  /**
   * Optional product-specific vector hooks. Redis vector APIs differ across
   * Redis Stack, RediSearch deployments, and managed providers, so Crux does
   * not assume a universal command shape.
   */
  vector?: RedisVectorHooks
}

/**
 * Create a `CruxStore` backed by Redis.
 *
 * Each CruxStore key is stored as a Redis key with the configured prefix.
 * Values are JSON-serialized. Change notifications are published to a
 * Redis channel when `subscriber` is provided.
 *
 * @param config - Redis client, prefix, and optional subscriber.
 * @returns A `CruxStore` with optional `subscribe()` support.
 *
 * @example
 * ```ts
 * import { Redis } from '@upstash/redis'
 * import { cruxRedisStore } from '@crux/upstash/redis'
 *
 * const store = cruxRedisStore({
 *   redis: new Redis({ url: process.env.UPSTASH_URL!, token: process.env.UPSTASH_TOKEN! }),
 *   prefix: 'myapp:',
 * })
 *
 * // Use with plan/task helpers:
 * const plan = await createPlan(store, { title: 'My Plan' })
 * ```
 */
export function cruxRedisStore(config: CruxRedisStoreConfig): CruxStore {
  const { redis, prefix = 'crux:', subscriber, vector } = config
  const channel = `${prefix}events`

  function redisKey(key: string): string {
    return `${prefix}${key}`
  }

  function stripPrefix(redisKey: string): string {
    return redisKey.startsWith(prefix) ? redisKey.slice(prefix.length) : redisKey
  }

  async function publishEvent(event: { key: string; type: 'set' | 'delete'; value?: JsonObject }) {
    const message = JSON.stringify(event)
    await redis.publish(channel, message).catch(() => {
      // Publishing is best-effort — don't fail writes on pub errors
    })
  }

  const store: CruxStore = {
    async get(key: string): Promise<JsonObject | null> {
      const raw = await redis.get(redisKey(key))
      if (raw === null) return null
      return decodeRedisValue(raw)
    },

    async set(key: string, value: JsonObject, options?: SetOptions): Promise<void> {
      const opts = options?.ttl !== undefined && options.ttl > 0 ? { px: options.ttl } : undefined
      await redis.set(redisKey(key), JSON.stringify(value), opts)
      await vector?.upsert?.({ key, redisKey: redisKey(key), value })
      await publishEvent({ key, type: 'set', value })
    },

    async delete(key: string): Promise<void> {
      await redis.del(redisKey(key))
      await vector?.delete?.({ key, redisKey: redisKey(key) })
      await publishEvent({ key, type: 'delete' })
    },

    async list(listPrefix: string, options?: ListOptions): Promise<ListResult> {
      // Fetch all keys matching the prefix
      const pattern = `${prefix}${listPrefix}*`
      const keys = await redis.keys(pattern)

      if (keys.length === 0) {
        return { entries: [] }
      }

      // Fetch all values
      const entries: StoreEntry[] = []
      for (const rKey of keys) {
        const raw = await redis.get(rKey)
        if (raw !== null) {
          const value = decodeRedisValue(raw)
          const key = stripPrefix(rKey)

          // Apply filter
          if (options?.filter) {
            if (!matchesFilter(value, options.filter)) continue
          }

          entries.push({ key, value })
        }
      }

      // Sort by updatedAt descending
      entries.sort((a, b) => {
        const aTime = typeof a.value.updatedAt === 'number' ? a.value.updatedAt : 0
        const bTime = typeof b.value.updatedAt === 'number' ? b.value.updatedAt : 0
        return bTime - aTime
      })

      // Pagination
      let result = entries
      if (options?.cursor) {
        const idx = result.findIndex((e) => e.key === options.cursor)
        if (idx >= 0) result = result.slice(idx + 1)
      }

      if (options?.limit !== undefined && options.limit >= 0) {
        const hasMore = result.length > options.limit
        result = result.slice(0, options.limit)
        return {
          entries: result,
          cursor: hasMore ? result[result.length - 1]?.key : undefined,
        }
      }

      return { entries: result }
    },

    supportsTtl(): boolean {
      return true
    },

    capabilities() {
      return {
        ttl: true,
        ...(vector
          ? {
              vectorSearch: {
                dense: vector.capabilities?.dense ?? true,
                sparse: vector.capabilities?.sparse ?? false,
                hybrid: vector.capabilities?.hybrid ?? false,
              },
              semanticCache: {
                isolatedVectorNamespace: Boolean(vector.semanticCache?.isolatedVectorNamespace),
              },
            }
          : {}),
      }
    },
  }

  if (vector) {
    store.searchVectors = async (query: VectorSearchQuery): Promise<ScoredEntry[]> => {
      if (!query.dense && !query.sparse) {
        throw new Error('Redis searchVectors() requires a dense or sparse query vector.')
      }
      if (query.sparse && query.dense && vector.capabilities?.hybrid === false) {
        throw new Error('Redis vector hooks do not support hybrid dense+sparse retrieval.')
      }
      if (query.sparse && !query.dense && vector.capabilities?.sparse !== true) {
        throw new Error('Redis vector hooks do not support sparse retrieval.')
      }

      const results = await vector.searchVectors(query, {
        prefix,
        redisKey,
        getValue: (key) => store.get(key),
      })

      const entries: ScoredEntry[] = []
      for (const result of results) {
        if (query.threshold !== undefined && result.score < query.threshold) continue
        const value = result.value ?? (await store.get(result.key))
        if (!value) continue
        if (query.filter && !matchesFilter(value, query.filter)) continue
        entries.push({ key: result.key, value, score: result.score })
      }
      return entries
    }

    store.vectorSearch = (embedding: number[], options?: VectorSearchOptions): Promise<ScoredEntry[]> => {
      return store.searchVectors!({
        dense: embedding,
        limit: options?.limit,
        threshold: options?.threshold,
        filter: options?.filter,
      })
    }
  }

  // Add subscribe() if a subscriber is provided
  if (subscriber) {
    const listeners = new Set<(event: StoreEvent) => void>()
    let subscribed = false

    store.subscribe = (callback: (event: StoreEvent) => void) => {
      listeners.add(callback)

      // Start subscribing on first listener
      if (!subscribed) {
        subscribed = true
        subscriber
          .subscribe<string>(channel, (message) => {
            try {
              const parsed = JSON.parse(message) as { key: string; type: 'set' | 'delete'; value?: JsonObject }
              const event: StoreEvent =
                parsed.type === 'set'
                  ? { type: 'set', key: parsed.key, value: parsed.value!, timestamp: Date.now() }
                  : { type: 'delete', key: parsed.key, timestamp: Date.now() }
              for (const listener of listeners) {
                listener(event)
              }
            } catch {
              // Ignore malformed messages
            }
          })
          .catch(() => {
            // Subscription failed — listeners won't receive events
          })
      }

      return () => {
        listeners.delete(callback)
      }
    }
  }

  return store
}

function decodeRedisValue(raw: string | JsonObject): JsonObject {
  if (typeof raw === 'string') {
    return JSON.parse(raw) as JsonObject
  }
  return raw
}
