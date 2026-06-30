/**
 * In-memory Storage Beta adapters.
 *
 * These wrappers expose the beta `RecordStore`/`VectorStore`/`BlobStore`
 * names while the legacy in-memory implementation is migrated in Phase 2.
 *
 * @module
 */

import {
  inMemoryBlobStore as createLegacyBlobStore,
  inMemoryCruxStore,
  inMemoryVectorStore as createLegacyVectorStore,
} from '../store/memory'
import type {
  BlobReadResult as LegacyBlobReadResult,
  BlobRef as LegacyBlobRef,
  BlobStore as LegacyBlobStore,
  CruxStore,
  JsonObject as LegacyJsonObject,
  SparseVector as LegacySparseVector,
  VectorHit as LegacyVectorHit,
  VectorRecord as LegacyVectorRecord,
  VectorSearchQuery as LegacyVectorSearchQuery,
  VectorStore as LegacyVectorStore,
} from '../store/types'
import { StorageError } from './errors'
import { storage } from './bundle'
import type {
  BlobPutInput,
  BlobReadResult,
  BlobRef,
  BlobStore,
  ExactFilter,
  JsonObject,
  RecordListOptions,
  RecordStore,
  RecordWriteOptions,
  Storage,
  VectorHit,
  VectorRecord,
  VectorSearchQuery,
  VectorStore,
} from './types'

/** Create an in-memory JSON record store for tests and local development. */
export function inMemoryRecordStore<T extends JsonObject = JsonObject>(): RecordStore<T> {
  return adaptRecordStore<T>(inMemoryCruxStore())
}

/** Create an in-memory vector store for dense, sparse, and hybrid search. */
export function inMemoryVectorStore(): VectorStore {
  return adaptVectorStore(createLegacyVectorStore())
}

/** Create an in-memory blob store for tests and local development. */
export function inMemoryBlobStore(): BlobStore {
  return adaptBlobStore(createLegacyBlobStore())
}

/** Create the default in-memory storage bundle. */
export function inMemoryStorage(): Storage {
  return storage({
    records: inMemoryRecordStore(),
    vectors: inMemoryVectorStore(),
    blobs: inMemoryBlobStore(),
  })
}

function adaptRecordStore<T extends JsonObject>(legacy: CruxStore): RecordStore<T> {
  return {
    _tag: 'RecordStore',
    get: async (key) => fromLegacyValue<T>(await legacy.get(key)),
    getMany: async (keys) => Promise.all(keys.map((key) => legacy.get(key).then(fromLegacyValue<T>))),
    put: (key, value, options) => legacy.set(key, toLegacyValue(value), toLegacyWriteOptions(options)),
    putMany: async (entries) => {
      for (const entry of entries) {
        await legacy.set(entry.key, toLegacyValue(entry.value), toLegacyWriteOptions(entry.options))
      }
    },
    create: (key, value, options) => legacy.setIfAbsent(key, toLegacyValue(value), toLegacyWriteOptions(options)),
    delete: (key) => legacy.delete(key),
    deleteMany: async (keys) => {
      for (const key of keys) {
        await legacy.delete(key)
      }
    },
    list: async (prefix, options) => {
      const page = await legacy.list(prefix, toLegacyListOptions(options))
      return {
        entries: page.entries.map((entry) => ({
          key: entry.key,
          value: fromLegacyValue<T>(entry.value) ?? emptyRecord<T>(),
        })),
        cursor: page.cursor,
      }
    },
    scan: async function* (prefix, options) {
      let cursor: string | undefined
      do {
        const page = await legacy.list(prefix, toLegacyListOptions({ ...options, cursor }))
        for (const entry of page.entries) {
          yield {
            key: entry.key,
            value: fromLegacyValue<T>(entry.value) ?? emptyRecord<T>(),
          }
        }
        cursor = page.cursor
      } while (cursor)
    },
    watch: legacy.subscribe
      ? (prefix, callback) =>
          legacy.subscribe!((event) => {
            if (!event.key.startsWith(prefix)) return
            if (event.type === 'delete') {
              callback({ type: 'delete', key: event.key, timestamp: event.timestamp })
              return
            }
            callback({
              type: 'put',
              key: event.key,
              value: fromLegacyValue<T>(event.value) ?? emptyRecord<T>(),
              timestamp: event.timestamp,
            })
          })
      : undefined,
    capabilities: () => ({
      ttl: 'lazy',
      filter: 'scan',
      watch: true,
      batch: false,
    }),
  }
}

function adaptVectorStore(legacy: LegacyVectorStore): VectorStore {
  return {
    _tag: 'VectorStore',
    upsert: (records) => legacy.upsert(records.map(toLegacyVectorRecord)),
    delete: (keys) => legacy.delete(keys),
    search: async (query) => {
      if (query.fusion) {
        throw new StorageError('unsupported_capability', `Vector fusion mode "${query.fusion}" is not supported.`)
      }
      return (await legacy.search(toLegacyVectorSearchQuery(query))).map(fromLegacyVectorHit)
    },
    capabilities: () => ({
      dense: true,
      sparse: true,
      hybrid: true,
      fusion: [],
      filter: 'post',
      consistency: 'strong',
    }),
  }
}

function adaptBlobStore(legacy: LegacyBlobStore): BlobStore {
  return {
    _tag: 'BlobStore',
    put: async (input) => fromLegacyBlobRef(await legacy.put(toLegacyBlobPutInput(input))),
    get: async (uri) => fromLegacyBlobReadResult(await legacy.get(uri)),
    delete: async (uri) => {
      if (!legacy.delete) return
      await legacy.delete(uri)
    },
    capabilities: () => ({
      multipart: false,
      signedUrls: false,
    }),
  }
}

function toLegacyWriteOptions(options: RecordWriteOptions | undefined): { ttl?: number } | undefined {
  return options?.ttlMs === undefined ? undefined : { ttl: options.ttlMs }
}

function toLegacyListOptions(options: RecordListOptions | undefined): {
  limit?: number
  cursor?: string
  filter?: Record<string, unknown>
} {
  return {
    limit: options?.limit,
    cursor: options?.cursor,
    filter: options?.filter ? { ...options.filter } : undefined,
  }
}

function toLegacyVectorSearchQuery(query: VectorSearchQuery): LegacyVectorSearchQuery {
  if (!('mode' in query)) {
    const legacyQuery = query as LegacyVectorSearchQuery
    return {
      dense: legacyQuery.dense ? [...legacyQuery.dense] : undefined,
      sparse: legacyQuery.sparse ? toLegacySparseVector(legacyQuery.sparse) : undefined,
      limit: legacyQuery.limit,
      threshold: legacyQuery.threshold,
      filter: legacyQuery.filter ? { ...legacyQuery.filter } : undefined,
      fusion: legacyQuery.fusion,
    }
  }

  return {
    dense: query.mode === 'dense' || query.mode === 'hybrid' ? [...query.dense] : undefined,
    sparse: query.mode === 'sparse' || query.mode === 'hybrid' ? toLegacySparseVector(query.sparse) : undefined,
    limit: query.limit,
    threshold: query.threshold,
    filter: query.filter ? { ...query.filter } : undefined,
  }
}

function toLegacyVectorRecord(record: VectorRecord): LegacyVectorRecord {
  return {
    key: record.key,
    dense: record.dense ? [...record.dense] : undefined,
    sparse: record.sparse ? toLegacySparseVector(record.sparse) : undefined,
    metadata: record.metadata ? { ...record.metadata } : undefined,
  }
}

function toLegacySparseVector(vector: { readonly indices: readonly number[]; readonly values: readonly number[] }): LegacySparseVector {
  return {
    indices: [...vector.indices],
    values: [...vector.values],
  }
}

function fromLegacyVectorHit(hit: LegacyVectorHit): VectorHit {
  return {
    key: hit.key,
    score: hit.score,
    metadata: toExactFilter(hit.metadata),
  }
}

function toLegacyBlobPutInput(input: BlobPutInput): Parameters<LegacyBlobStore['put']>[0] {
  return {
    key: input.key,
    content: input.content,
    mimeType: input.mimeType,
    metadata: input.metadata ? { ...input.metadata } : undefined,
  }
}

function fromLegacyBlobRef(ref: LegacyBlobRef): BlobRef {
  return ref
}

function fromLegacyBlobReadResult(result: LegacyBlobReadResult): BlobReadResult {
  return result
}

function toLegacyValue(value: JsonObject): LegacyJsonObject {
  return value as unknown as LegacyJsonObject
}

function fromLegacyValue<T extends JsonObject>(value: LegacyJsonObject | null): T | null {
  return value as unknown as T | null
}

function toExactFilter(value: Record<string, unknown> | undefined): ExactFilter | undefined {
  if (!value) return undefined
  const filter: Record<string, string | number | boolean | null> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean' || item === null) {
      filter[key] = item
    }
  }
  return filter
}

function emptyRecord<T extends JsonObject>(): T {
  return {} as T
}
