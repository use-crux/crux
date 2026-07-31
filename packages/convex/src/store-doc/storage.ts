/**
 * Storage Beta adapters over the Convex store document I/O port.
 *
 * This module implements beta `RecordStore` behavior over the shared component
 * document contract.
 *
 * @module
 */

import { StorageError } from '@use-crux/core/storage'
import type { JsonObject, RecordEntry, RecordListOptions, RecordStore, RecordWriteOptions } from '@use-crux/core/storage'
import { createStoreDocCodec } from './codec'
import type { ComponentDocumentPort, DecodedStoreDoc, StoreDocRecord } from './types'
import { storeDocVersion } from './version'
import {
  assertExactFilter,
  assertStorageKey,
  cloneJsonObject,
  matchesExactFilter,
  normalizeTtlMs,
} from './storage-utils'

/** Configuration for {@link createStoreDocRecordStore}. */
export interface StoreDocRecordStoreConfig<TDoc extends StoreDocRecord = StoreDocRecord> {
  /** Adapter-local document I/O port. */
  readonly io: ComponentDocumentPort<TDoc>
  /** Clock used for writes and TTL checks. Defaults to `Date.now`. */
  readonly now?: () => number
}

/** Create a beta `RecordStore` from a Convex component document port. */
export function createStoreDocRecordStore<T extends JsonObject = JsonObject>(
  config: StoreDocRecordStoreConfig,
): RecordStore<T> {
  const codec = createStoreDocCodec({ now: config.now })

  const decode = async (doc: StoreDocRecord | null): Promise<T | null> => {
    if (!doc) return null
    const decoded = codec.decode(doc)
    if (decoded.expired) {
      await config.io.delete(decoded.key)
      return null
    }
    return cloneJsonObject(decoded.value as unknown as JsonObject) as T
  }

  const encode = (key: string, value: T, options?: RecordWriteOptions) => {
    assertStorageKey(key)
    const ttl = normalizeTtlMs(options?.ttlMs)
    return codec.encode(key, cloneJsonObject(value) as never, ttl === undefined ? undefined : { ttlMs: ttl })
  }

  async function list(prefix: string, options?: RecordListOptions) {
    const normalized = normalizeListOptions(options)
    if (normalized.limit === 0) return { entries: [] }

    const entries: RecordEntry<T>[] = []
    let cursor = normalized.cursor
    do {
      const page = await config.io.list({
        prefix,
        ...(normalized.limit === undefined ? {} : { limit: normalized.limit - entries.length }),
        ...(cursor === undefined ? {} : { cursor }),
      })
      const decoded = page.docs.map((doc) => codec.decode(doc))
      await cleanupExpired(config.io, decoded)
      for (const doc of decoded) {
        if (doc.expired) continue
        const value = doc.value as unknown as JsonObject
        if (!normalized.filter || matchesExactFilter(value, normalized.filter)) {
          entries.push({ key: doc.key, value: cloneJsonObject(value) as T })
        }
        if (normalized.limit !== undefined && entries.length >= normalized.limit) {
          return { entries, ...(page.cursor === undefined ? {} : { cursor: page.cursor }) }
        }
      }
      cursor = page.cursor
    } while (cursor !== undefined)
    return { entries }
  }

  return {
    _tag: 'RecordStore',
    async get(key) {
      assertStorageKey(key)
      return decode(await config.io.get(key))
    },
    async put(key, value, options) {
      await config.io.put(encode(key, value, options))
    },
    async create(key, value, options) {
      return config.io.insert(encode(key, value, options))
    },
    async delete(key) {
      assertStorageKey(key)
      await config.io.delete(key)
    },
    async getVersioned(key) {
      assertStorageKey(key)
      const doc = await config.io.get(key)
      if (!doc) return { value: null, version: null }
      const decoded = codec.decode(doc)
      if (decoded.expired) {
        await config.io.delete(decoded.key)
        return { value: null, version: null }
      }
      return {
        value: cloneJsonObject(decoded.value) as T,
        version: storeDocVersion(doc),
      }
    },
    async putVersioned(key, value, expectedVersion) {
      assertStorageKey(key)
      return config.io.compareAndSet(
        key,
        expectedVersion,
        value === null ? null : encode(key, value),
      )
    },
    list,
    async *scan(prefix, options) {
      let cursor: string | undefined
      do {
        const page = await list(prefix, { ...options, cursor })
        yield* page.entries
        cursor = page.cursor
      } while (cursor)
    },
    capabilities: () => ({
      ttl: 'lazy',
      filter: 'scan',
      watch: false,
      batch: false,
      mutate: 'cas',
    }),
  }
}

function normalizeListOptions(options: RecordListOptions | undefined): RecordListOptions {
  if (options?.filter) assertExactFilter(options.filter)
  if (options?.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 0)) {
    throw new StorageError('invalid_value', 'Record list limit must be a non-negative integer.')
  }
  return { limit: options?.limit, cursor: options?.cursor, filter: options?.filter }
}

async function cleanupExpired(io: ComponentDocumentPort, decoded: readonly DecodedStoreDoc[]): Promise<void> {
  await Promise.all(
    decoded.filter((doc) => doc.expired).map((doc) => io.delete(doc.key).catch(() => undefined)),
  )
}
