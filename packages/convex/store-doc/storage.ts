/**
 * Storage Beta adapters over the Convex store document I/O port.
 *
 * This module keeps beta `RecordStore` and `VectorStore` behavior separate from
 * the legacy combined `CruxStore` policy while reusing the same component
 * document contract.
 *
 * @module
 */

import { StorageError } from '@use-crux/core/storage'
import type {
  ExactFilter,
  JsonObject,
  RecordEntry,
  RecordListOptions,
  RecordStore,
  RecordWriteOptions,
  VectorHit,
  VectorRecord,
  VectorSearchQuery,
  VectorStore,
} from '@use-crux/core/storage'
import { createStoreDocCodec } from './codec'
import type { ComponentDocumentPort, DecodedStoreDoc, StoreDocRecord } from './types'
import {
  assertExactFilter,
  assertStorageKey,
  cloneDenseVector,
  cloneExactFilter,
  cloneJsonObject,
  cloneSparseVector,
  exactMetadataFromJson,
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

/** Configuration for {@link createStoreDocVectorStore}. */
export interface StoreDocVectorStoreConfig<TDoc extends StoreDocRecord = StoreDocRecord> {
  /** Adapter-local document I/O port with optional dense vector search. */
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
    return codec.encode(key, cloneJsonObject(value) as never, ttl === undefined ? undefined : { ttl })
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
    }),
  }
}

/** Create a dense-only beta `VectorStore` from a Convex document port. */
export function createStoreDocVectorStore(config: StoreDocVectorStoreConfig): VectorStore {
  const codec = createStoreDocCodec({ now: config.now })

  return {
    _tag: 'VectorStore',
    async upsert(records) {
      for (const record of records) {
        await config.io.put(encodeVectorRecord(codec, record))
      }
    },
    async delete(keys) {
      for (const key of keys) {
        assertStorageKey(key)
        await config.io.delete(key)
      }
    },
    async search(query) {
      const normalized = normalizeDenseQuery(query)
      if (!config.io.searchDense) return []
      const docs = await config.io.searchDense({ vector: [...normalized.dense], limit: normalized.limit })
      const decoded = docs.map((doc) => codec.decode(doc))
      await cleanupExpired(config.io, decoded)
      return decoded
        .filter((doc) => !doc.expired)
        .map((doc): VectorHit => {
          const metadata = exactMetadataFromJson(doc.value as unknown as JsonObject)
          return {
            key: doc.key,
            score: doc.score ?? 0,
            ...(metadata ? { metadata } : {}),
          }
        })
        .filter((hit) => hit.score >= normalized.threshold)
        .filter((hit) => (normalized.filter ? matchesExactFilter(hit.metadata, normalized.filter) : true))
    },
    capabilities: () => ({
      dense: Boolean(config.io.searchDense),
      sparse: false,
      hybrid: false,
      fusion: [],
      filter: 'post',
      consistency: 'strong',
    }),
  }
}

function encodeVectorRecord(codec: ReturnType<typeof createStoreDocCodec>, record: VectorRecord) {
  assertStorageKey(record.key)
  const dense = record.dense === undefined ? undefined : cloneDenseVector(record.dense)
  const sparse = record.sparse === undefined ? undefined : cloneSparseVector(record.sparse)
  const metadata = record.metadata === undefined ? undefined : cloneExactFilter(record.metadata)
  if (!dense && !sparse) throw new StorageError('invalid_value', 'Vector records require a dense vector.')
  if (sparse) throw new StorageError('unsupported_capability', 'Convex vector storage supports dense vectors only.')
  return codec.encode(record.key, ({ ...(metadata ?? {}), embedding: dense } satisfies JsonObject) as never)
}

function normalizeDenseQuery(query: VectorSearchQuery): {
  readonly dense: readonly number[]
  readonly limit: number
  readonly threshold: number
  readonly filter?: ExactFilter
} {
  if (query.mode === 'sparse') {
    cloneSparseVector(query.sparse)
    throw new StorageError('unsupported_capability', 'Convex vector storage does not support sparse search.')
  }
  if (query.mode === 'hybrid') {
    cloneDenseVector(query.dense)
    cloneSparseVector(query.sparse)
    throw new StorageError('unsupported_capability', 'Convex vector storage does not support hybrid search.')
  }
  const limit = normalizeLimit(query.limit)
  const threshold = normalizeThreshold(query.threshold)
  const filter = query.filter === undefined ? undefined : cloneExactFilter(query.filter)
  return { dense: cloneDenseVector(query.dense), limit, threshold, ...(filter ? { filter } : {}) }
}

function normalizeListOptions(options: RecordListOptions | undefined): RecordListOptions {
  if (options?.filter) assertExactFilter(options.filter)
  if (options?.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 0)) {
    throw new StorageError('invalid_value', 'Record list limit must be a non-negative integer.')
  }
  return { limit: options?.limit, cursor: options?.cursor, filter: options?.filter }
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) return 10
  if (!Number.isInteger(value) || value < 0) {
    throw new StorageError('invalid_value', 'Vector search limit must be a non-negative integer.')
  }
  return value
}

function normalizeThreshold(value: number | undefined): number {
  if (value === undefined) return 0
  if (!Number.isFinite(value)) {
    throw new StorageError('invalid_value', 'Vector search threshold must be a finite number.')
  }
  return value
}

async function cleanupExpired(io: ComponentDocumentPort, decoded: readonly DecodedStoreDoc[]): Promise<void> {
  await Promise.all(
    decoded.filter((doc) => doc.expired).map((doc) => io.delete(doc.key).catch(() => undefined)),
  )
}
