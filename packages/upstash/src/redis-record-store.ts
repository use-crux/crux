/**
 * Upstash Redis `RecordStore` adapter for Storage Beta.
 *
 * The adapter uses Redis string values for JSON records, Redis PX expiry for
 * native TTL, and cursor-based SCAN for prefix listing. It intentionally avoids
 * Redis KEYS so production list calls do not block the database.
 *
 * @module
 */

import { StorageError } from '@use-crux/core/storage'
import type {
  ExactFilter,
  JsonObject,
  JsonValue,
  RecordEntry,
  RecordEvent,
  RecordListOptions,
  RecordStore,
  RecordWriteOptions,
} from '@use-crux/core/storage'

/** Minimal Redis client shape required by {@link upstashRedisRecordStore}. */
export interface RedisRecordClient {
  get<T = string | JsonObject>(key: string): Promise<T | null>
  set(key: string, value: string, opts?: { px?: number; nx?: true }): Promise<'OK' | null>
  del(...keys: string[]): Promise<number>
  eval<TResult = unknown>(
    script: string,
    keys: string[],
    args: unknown[],
  ): Promise<TResult>
  scan(cursor: string, options?: { match?: string; count?: number }): Promise<readonly [string | number, string[]]>
  publish(channel: string, message: string): Promise<number>
}

/** Minimal Redis subscriber shape for record watch support. */
export interface RedisSubscriber {
  subscribe<T = string>(channel: string, callback: (message: T) => void): Promise<void>
  unsubscribe(channel: string): Promise<void>
}

/** Configuration for {@link upstashRedisRecordStore}. */
export interface UpstashRedisRecordStoreConfig {
  /** Redis client instance, for example `new Redis({ url, token })`. */
  readonly redis: RedisRecordClient
  /** Redis key prefix for this logical record store. Defaults to `crux:`. */
  readonly prefix?: string
  /** Optional subscriber used to expose `RecordStore.watch()`. */
  readonly subscriber?: RedisSubscriber
  /** SCAN count hint used when listing records. Defaults to `100`. */
  readonly scanCount?: number
}

/** Create a Storage Beta `RecordStore` backed by Upstash Redis. */
export function upstashRedisRecordStore<T extends JsonObject = JsonObject>(
  config: UpstashRedisRecordStoreConfig,
): RecordStore<T> {
  const { redis, prefix = 'crux:', scanCount = 100, subscriber } = config
  const channel = `${prefix}events`
  const watchers = new Set<{ readonly prefix: string; readonly callback: (event: RecordEvent<T>) => void }>()
  let subscribed = false

  const recordKey = (key: string): string => `${prefix}${key}`
  const stripPrefix = (key: string): string => (key.startsWith(prefix) ? key.slice(prefix.length) : key)

  async function publish(event: RecordEvent<T>): Promise<void> {
    await redis.publish(channel, JSON.stringify(event)).catch(() => {
      // Watch delivery is best-effort and must not fail storage writes.
    })
  }

  async function list(prefixQuery: string, options?: RecordListOptions) {
    const normalized = normalizeListOptions(options)
    if (normalized.limit === 0) return { entries: [] }

    const entries: RecordEntry<T>[] = []
    let cursor = normalized.cursor ?? '0'
    do {
      const [nextCursor, keys] = await scanKeys(redis, cursor, {
        match: `${prefix}${prefixQuery}*`,
        count: normalized.limit ?? scanCount,
      })
      cursor = nextCursor
      for (const redisKey of keys) {
        const value = await readValue<T>(redis, redisKey)
        if (!value) continue
        const key = stripPrefix(redisKey)
        if (!normalized.filter || matchesExactFilter(value, normalized.filter)) {
          entries.push({ key, value })
        }
        if (normalized.limit !== undefined && entries.length >= normalized.limit) {
          return { entries, ...(cursor === '0' ? {} : { cursor }) }
        }
      }
    } while (cursor !== '0')

    entries.sort((left, right) => left.key.localeCompare(right.key))
    return { entries }
  }

  const store: RecordStore<T> = {
    _tag: 'RecordStore',
    async get(key) {
      assertKey(key)
      return readValue<T>(redis, recordKey(key))
    },
    async put(key, value, options) {
      assertKey(key)
      const stored = cloneJsonObject(value)
      const writeOptions = redisWriteOptions(options)
      await writeRedis(redis, recordKey(key), stored, writeOptions)
      await publish({ type: 'put', key, value: cloneJsonObject(stored) as T, timestamp: Date.now() })
    },
    async create(key, value, options) {
      assertKey(key)
      const stored = cloneJsonObject(value)
      const result = await writeRedis(redis, recordKey(key), stored, { ...redisWriteOptions(options), nx: true })
      if (!result) return false
      await publish({ type: 'put', key, value: cloneJsonObject(stored) as T, timestamp: Date.now() })
      return true
    },
    async delete(key) {
      assertKey(key)
      await redis.del(recordKey(key))
      await publish({ type: 'delete', key, timestamp: Date.now() })
    },
    async getVersioned(key) {
      assertKey(key)
      return readVersionedValue<T>(redis, recordKey(key))
    },
    async putVersioned(key, value, expectedVersion) {
      assertKey(key)
      const stored = value === null ? null : (cloneJsonObject(value) as T)
      const committed = await compareAndSet(
        redis,
        recordKey(key),
        expectedVersion,
        stored,
      )
      if (!committed) return false
      await publish(
        stored === null
          ? { type: 'delete', key, timestamp: Date.now() }
          : {
              type: 'put',
              key,
              value: cloneJsonObject(stored) as T,
              timestamp: Date.now(),
            },
      )
      return true
    },
    list,
    async *scan(prefixQuery, options) {
      let cursor: string | undefined
      do {
        const page = await list(prefixQuery, { ...options, cursor })
        yield* page.entries
        cursor = page.cursor
      } while (cursor)
    },
    capabilities: () => ({
      ttl: 'native',
      filter: 'scan',
      watch: Boolean(subscriber),
      batch: false,
      mutate: 'cas',
    }),
    ...(subscriber
      ? {
          watch(prefixQuery: string, callback: (event: RecordEvent<T>) => void) {
            watchers.add({ prefix: prefixQuery, callback })
            if (!subscribed) {
              subscribed = true
              subscriber.subscribe<string>(channel, (message) => dispatchWatchEvent(message, watchers)).catch(() => {})
            }
            return () => {
              for (const watcher of watchers) {
                if (watcher.prefix === prefixQuery && watcher.callback === callback) {
                  watchers.delete(watcher)
                  break
                }
              }
              if (watchers.size === 0 && subscribed) {
                subscribed = false
                subscriber.unsubscribe(channel).catch(() => {})
              }
            }
          },
        }
      : {}),
  }
  return store
}

const COMPARE_AND_SET_SCRIPT = `
local current = redis.call("GET", KEYS[1])
if ARGV[1] == "missing" then
  if current then return 0 end
elseif not current or redis.sha1hex(current) ~= ARGV[2] then
  return 0
end
if ARGV[3] == "delete" then
  redis.call("DEL", KEYS[1])
else
  redis.call("SET", KEYS[1], ARGV[4])
end
return 1
`

const VERSIONED_READ_SCRIPT = `
local current = redis.call("GET", KEYS[1])
if not current then return nil end
return {current, redis.sha1hex(current)}
`

async function readVersionedValue<T extends JsonObject>(
  redis: RedisRecordClient,
  key: string,
): Promise<{ readonly value: T | null; readonly version: string | null }> {
  try {
    const result = await redis.eval<readonly [string, string] | null>(
      VERSIONED_READ_SCRIPT,
      [key],
      [],
    )
    if (result === null) return { value: null, version: null }
    const [raw, version] = result
    return {
      value: cloneJsonObject(JSON.parse(raw) as unknown) as T,
      version,
    }
  } catch (cause) {
    throw new StorageError('backend_error', 'Upstash Redis versioned read failed.', { cause })
  }
}

async function compareAndSet<T extends JsonObject>(
  redis: RedisRecordClient,
  key: string,
  expectedVersion: string | null,
  value: T | null,
): Promise<boolean> {
  try {
    const result = await redis.eval<number>(
      COMPARE_AND_SET_SCRIPT,
      [key],
      [
        expectedVersion === null ? 'missing' : 'present',
        expectedVersion ?? '',
        value === null ? 'delete' : 'put',
        value === null ? '' : JSON.stringify(value),
      ],
    )
    return result === 1
  } catch (cause) {
    throw new StorageError('backend_error', 'Upstash Redis compare-and-set failed.', { cause })
  }
}

async function scanKeys(
  redis: RedisRecordClient,
  cursor: string,
  options: { readonly match: string; readonly count: number },
): Promise<readonly [string, string[]]> {
  try {
    const [nextCursor, keys] = await redis.scan(cursor, options)
    return [String(nextCursor), keys]
  } catch (cause) {
    throw new StorageError('backend_error', 'Upstash Redis scan failed.', { cause })
  }
}

async function readValue<T extends JsonObject>(redis: RedisRecordClient, key: string): Promise<T | null> {
  try {
    const raw = await redis.get(key)
    if (raw === null) return null
    return cloneJsonObject(typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw) as T
  } catch (cause) {
    throw new StorageError('backend_error', 'Upstash Redis read failed.', { cause })
  }
}

async function writeRedis(
  redis: RedisRecordClient,
  key: string,
  value: JsonObject,
  options?: { readonly px?: number; readonly nx?: true },
): Promise<boolean> {
  try {
    return (await redis.set(key, JSON.stringify(value), options)) === 'OK'
  } catch (cause) {
    throw new StorageError('backend_error', 'Upstash Redis write failed.', { cause })
  }
}

function dispatchWatchEvent<T extends JsonObject>(
  message: string,
  watchers: ReadonlySet<{ readonly prefix: string; readonly callback: (event: RecordEvent<T>) => void }>,
): void {
  try {
    const event = JSON.parse(message) as RecordEvent<T>
    for (const watcher of watchers) {
      if (event.key.startsWith(watcher.prefix)) watcher.callback(event)
    }
  } catch {
    // Ignore malformed pub/sub messages from shared Redis channels.
  }
}

function redisWriteOptions(options: RecordWriteOptions | undefined): { readonly px?: number } | undefined {
  if (options?.ttlMs === undefined) return undefined
  if (!Number.isFinite(options.ttlMs) || !Number.isInteger(options.ttlMs) || options.ttlMs <= 0) {
    throw new StorageError('invalid_value', 'Record TTL must be a positive integer number of milliseconds.')
  }
  return { px: options.ttlMs }
}

function normalizeListOptions(options: RecordListOptions | undefined): RecordListOptions {
  if (options?.filter) assertExactFilter(options.filter)
  if (options?.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 0)) {
    throw new StorageError('invalid_value', 'Record list limit must be a non-negative integer.')
  }
  return { limit: options?.limit, cursor: options?.cursor, filter: options?.filter }
}

function cloneJsonObject(value: unknown): JsonObject {
  assertJsonValue(value)
  if (!isPlainObject(value)) throw new StorageError('invalid_value', 'Record values must be JSON objects.')
  return JSON.parse(JSON.stringify(value)) as JsonObject
}

function assertJsonValue(value: unknown): asserts value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (Array.isArray(value)) {
    value.forEach(assertJsonValue)
    return
  }
  if (isPlainObject(value)) {
    Object.values(value).forEach(assertJsonValue)
    return
  }
  throw new StorageError('invalid_value', 'Record values must be JSON serializable.')
}

function assertExactFilter(filter: ExactFilter): void {
  for (const [key, value] of Object.entries(filter)) {
    if (key.includes('.') || !isFilterValue(value)) {
      throw new StorageError('invalid_filter', 'Record filters support exact top-level scalar equality only.')
    }
  }
}

function matchesExactFilter(value: JsonObject, filter: ExactFilter): boolean {
  return Object.entries(filter).every(([key, expected]) =>
    Object.prototype.hasOwnProperty.call(value, key) ? value[key] === expected : false,
  )
}

function assertKey(key: string): void {
  if (key.length === 0) throw new StorageError('invalid_key', 'Record keys must not be empty.')
}

function isFilterValue(value: unknown): value is ExactFilter[string] {
  return (
    value === null ||
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value)) ||
    typeof value === 'boolean'
  )
}

function isPlainObject(value: unknown): value is { readonly [key: string]: unknown } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
