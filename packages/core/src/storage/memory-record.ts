/**
 * Functional in-memory `RecordStore` implementation.
 *
 * The store is intentionally small and contract-correct for tests and local
 * development: lazy TTL, scan-backed filtering, deterministic key ordering,
 * JSON isolation, and synchronous watch notifications.
 *
 * @module
 */

import type {
  JsonObject,
  RecordEntry,
  RecordEvent,
  RecordStore,
  RecordWriteOptions,
} from './types'
import {
  assertRecordWriteOptions,
  assertValidKey,
  cloneJsonObject,
  matchesExactFilter,
  normalizeRecordListOptions,
} from './memory-utils'

interface MemoryRecord<T extends JsonObject> {
  readonly value: T
  readonly expiresAt?: number
}

type Listener<T extends JsonObject> = (event: RecordEvent<T>) => void

/** Create an in-memory JSON record store for tests and local development. */
export function inMemoryRecordStore<T extends JsonObject = JsonObject>(): RecordStore<T> {
  const records = new Map<string, MemoryRecord<T>>()
  const listeners = new Set<Listener<T>>()
  const mutations = new Map<string, Promise<void>>()

  const getActiveRecord = (key: string): MemoryRecord<T> | undefined => {
    const record = records.get(key)
    if (!record) return undefined
    if (isExpired(record)) {
      records.delete(key)
      return undefined
    }
    return record
  }

  const activeEntries = (): readonly RecordEntry<T>[] =>
    Array.from(records.entries())
      .flatMap(([key, record]) => {
        if (isExpired(record)) {
          records.delete(key)
          return []
        }
        return [{ key, value: cloneJsonObject(record.value) }]
      })
      .sort((left, right) => left.key.localeCompare(right.key))

  const emit = (event: RecordEvent<T>): void => {
    for (const listener of listeners) {
      listener(cloneRecordEvent(event))
    }
  }

  const write = (key: string, value: T, options: RecordWriteOptions | undefined): void => {
    assertValidKey(key)
    assertRecordWriteOptions(options)
    records.set(key, {
      value: cloneJsonObject(value),
      ...(options?.ttlMs !== undefined ? { expiresAt: Date.now() + options.ttlMs } : {}),
    })
  }

  const listPage: RecordStore<T>['list'] = async (prefix, options) => {
    const normalized = normalizeRecordListOptions(options)
    const filtered = activeEntries().filter((entry) => {
      if (!entry.key.startsWith(prefix)) return false
      return normalized.filter ? matchesExactFilter(entry.value, normalized.filter) : true
    })
    const afterCursor = normalized.cursor
      ? filtered.slice(filtered.findIndex((entry) => entry.key === normalized.cursor) + 1)
      : filtered
    const limit = normalized.limit ?? afterCursor.length
    const entries = afterCursor.slice(0, limit)
    const hasMore = afterCursor.length > entries.length
    return {
      entries,
      ...(hasMore && entries.length > 0 ? { cursor: entries[entries.length - 1]?.key } : {}),
    }
  }

  return {
    _tag: 'RecordStore',
    async get(key) {
      assertValidKey(key)
      const record = getActiveRecord(key)
      return record ? cloneJsonObject(record.value) : null
    },
    async put(key, value, options) {
      write(key, value, options)
      emit({ type: 'put', key, value: cloneJsonObject(value), timestamp: Date.now() })
    },
    async create(key, value, options) {
      assertValidKey(key)
      if (getActiveRecord(key)) return false
      write(key, value, options)
      emit({ type: 'put', key, value: cloneJsonObject(value), timestamp: Date.now() })
      return true
    },
    async delete(key) {
      assertValidKey(key)
      records.delete(key)
      emit({ type: 'delete', key, timestamp: Date.now() })
    },
    list: listPage,
    async *scan(prefix, options) {
      let cursor: string | undefined
      do {
        const page = await listPage(prefix, { ...options, cursor })
        for (const entry of page.entries) {
          yield entry
        }
        cursor = page.cursor
      } while (cursor)
    },
    watch(prefix, callback) {
      const listener: Listener<T> = (event) => {
        if (event.key.startsWith(prefix)) callback(event)
      }
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    async mutate(key, fn) {
      assertValidKey(key)
      return serializeMutation(mutations, key, async () => {
        const record = getActiveRecord(key)
        const current = record ? cloneJsonObject(record.value) : null
        const mutation = await fn(current)
        if (mutation.type === 'none') {
          return current ? cloneJsonObject(current) : null
        }
        if (mutation.type === 'delete') {
          records.delete(key)
          emit({ type: 'delete', key, timestamp: Date.now() })
          return null
        }
        write(key, mutation.value, undefined)
        emit({
          type: 'put',
          key,
          value: cloneJsonObject(mutation.value),
          timestamp: Date.now(),
        })
        return cloneJsonObject(mutation.value)
      })
    },
    capabilities: () => ({
      ttl: 'lazy',
      filter: 'scan',
      watch: true,
      batch: false,
      mutate: 'native',
    }),
  }
}

function isExpired<T extends JsonObject>(record: MemoryRecord<T>): boolean {
  return record.expiresAt !== undefined && Date.now() >= record.expiresAt
}

function cloneRecordEvent<T extends JsonObject>(event: RecordEvent<T>): RecordEvent<T> {
  return event.type === 'put' ? { ...event, value: cloneJsonObject(event.value) } : { ...event }
}

async function serializeMutation<T>(
  mutations: Map<string, Promise<void>>,
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = mutations.get(key) ?? Promise.resolve()
  let release: (() => void) | undefined
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = previous.then(() => current)
  mutations.set(key, tail)
  await previous
  try {
    return await fn()
  } finally {
    release?.()
    if (mutations.get(key) === tail) mutations.delete(key)
  }
}
