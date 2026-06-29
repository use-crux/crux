/**
 * In-memory `CruxStore` implementation.
 *
 * Backed by a plain `Map`. All data lives in process memory and is lost
 * on restart. `vectorSearch()` computes cosine similarity over in-memory
 * dense vectors, while `searchVectors()` supports dense, sparse, and hybrid
 * queries. `subscribe()` notifies listeners synchronously on every set/delete.
 *
 * Use for: test suites, local development, rapid prototyping.
 * Not for production (no persistence, linear scan for vector search).
 *
 * @module
 */

import type {
  BlobReadResult,
  BlobRef,
  BlobStore,
  CruxStore,
  DataStore,
  JsonObject,
  ListOptions,
  ListResult,
  ScoredEntry,
  SetOptions,
  SparseVector,
  Storage,
  StoreEvent,
  VectorHit,
  VectorRecord,
  VectorSearchOptions,
  VectorSearchQuery,
  VectorStore,
} from './types'
import { matchesFilter } from './filter'
import { storage } from './types'

/**
 * Create an in-memory `CruxStore` backed by a `Map`.
 *
 * @example
 * ```ts
 * import { inMemoryCruxStore } from '@use-crux/core/store'
 *
 * const store = inMemoryCruxStore()
 * await store.set('plan:abc', { title: 'My Plan', version: 1 })
 * const plan = await store.get('plan:abc')
 * ```
 */
export function inMemoryCruxStore(): CruxStore {
  return createCombinedMemoryStore()
}

/** Create an in-memory document data store. */
export function inMemoryDataStore(): DataStore {
  return createMemoryDataStore()
}

/** Create an in-memory vector store for dense, sparse, and hybrid search. */
export function inMemoryVectorStore(): VectorStore {
  const records = new Map<string, VectorRecord>()

  return {
    _tag: 'VectorStore',
    async upsert(nextRecords: readonly VectorRecord[]): Promise<void> {
      for (const record of nextRecords) {
        records.set(record.key, cloneVectorRecord(record))
      }
    },
    async delete(keys: readonly string[]): Promise<void> {
      for (const key of keys) {
        records.delete(key)
      }
    },
    async search(query: VectorSearchQuery): Promise<readonly VectorHit[]> {
      if (!query.dense && !query.sparse) {
        throw new Error('VectorStore.search() requires a dense or sparse query vector.')
      }

      const threshold = query.threshold ?? 0
      const hits: VectorHit[] = Array.from(records.values()).flatMap((record) => {
        if (query.filter && record.metadata && !matchesFilter(record.metadata, query.filter)) return []
        const denseScore = query.dense && record.dense ? cosineSimilarity(query.dense, record.dense) : undefined
        const sparseScore =
          query.sparse && record.sparse ? sparseCosineSimilarity(query.sparse, record.sparse) : undefined
        const score = combineScores(denseScore, sparseScore)
        if (score === undefined || score < threshold) return []
        return [{ key: record.key, score, ...(record.metadata ? { metadata: record.metadata } : {}) }]
      })

      hits.sort((a, b) => b.score - a.score)
      return hits.slice(0, query.limit ?? 10)
    },
    capabilities() {
      return { dense: true, sparse: true, hybrid: true, fusion: ['rrf', 'dbsf'] as const }
    },
  }
}

/** Create an in-memory blob store for tests and local development. */
export function inMemoryBlobStore(): BlobStore {
  const blobs = new Map<string, BlobReadResult>()
  let counter = 0

  return {
    _tag: 'BlobStore',
    async put(input): Promise<BlobRef> {
      const size = await blobContentSize(input.content)
      counter += 1
      const uri = input.key ? `memory://${encodeURIComponent(input.key)}` : `memory://blob/${counter}`
      blobs.set(uri, {
        content: input.content,
        mimeType: input.mimeType,
        size,
      })
      return { uri, size }
    },
    async get(uri): Promise<BlobReadResult> {
      const entry = blobs.get(uri)
      if (!entry) throw new Error(`BlobStore: blob not found for URI "${uri}".`)
      return entry
    },
    async delete(uri): Promise<void> {
      blobs.delete(uri)
    },
    capabilities() {
      return {}
    },
  }
}

/** Create the default in-memory storage bundle. */
export function inMemoryStorage(): Storage {
  return storage({
    data: inMemoryDataStore(),
    vectors: inMemoryVectorStore(),
    blobs: inMemoryBlobStore(),
  })
}

function createCombinedMemoryStore(): CruxStore {
  const data = new Map<string, JsonObject>()
  const expiry = new Map<string, number>()
  const listeners = new Set<(event: StoreEvent) => void>()

  function emit(event: StoreEvent): void {
    for (const listener of listeners) {
      listener(event)
    }
  }

  function deepCopy(obj: JsonObject): JsonObject {
    return JSON.parse(JSON.stringify(obj))
  }

  function activeEntries(): Array<{ key: string; value: JsonObject }> {
    const now = Date.now()
    const entries: Array<{ key: string; value: JsonObject }> = []

    for (const [key, value] of data.entries()) {
      const expiresAt = expiry.get(key)
      if (expiresAt !== undefined && now >= expiresAt) {
        data.delete(key)
        expiry.delete(key)
        continue
      }
      entries.push({ key, value: deepCopy(value) })
    }

    return entries
  }

  return {
    async get(key: string): Promise<JsonObject | null> {
      const expiresAt = expiry.get(key)
      if (expiresAt !== undefined && Date.now() >= expiresAt) {
        data.delete(key)
        expiry.delete(key)
        return null
      }

      const value = data.get(key)
      return value ? deepCopy(value) : null
    },

    async set(key: string, value: JsonObject, options?: SetOptions): Promise<void> {
      data.set(key, deepCopy(value))
      if (options?.ttl !== undefined && options.ttl > 0) {
        expiry.set(key, Date.now() + options.ttl)
      } else {
        expiry.delete(key)
      }
      emit({ type: 'set', key, value: deepCopy(value), timestamp: Date.now() })
    },

    async delete(key: string): Promise<void> {
      data.delete(key)
      expiry.delete(key)
      emit({ type: 'delete', key, timestamp: Date.now() })
    },

    async list(prefix: string, options?: ListOptions): Promise<ListResult> {
      let entries = activeEntries().filter((entry) => entry.key.startsWith(prefix))

      if (options?.filter) {
        entries = entries.filter((entry) => matchesFilter(entry.value, options.filter!))
      }

      entries.sort((a, b) => {
        const aTime = typeof a.value.updatedAt === 'number' ? a.value.updatedAt : 0
        const bTime = typeof b.value.updatedAt === 'number' ? b.value.updatedAt : 0
        return bTime - aTime
      })

      if (options?.cursor) {
        const cursorIndex = entries.findIndex((entry) => entry.key === options.cursor)
        if (cursorIndex >= 0) {
          entries = entries.slice(cursorIndex + 1)
        }
      }

      if (options?.limit !== undefined && options.limit >= 0) {
        const hasMore = entries.length > options.limit
        const limited = entries.slice(0, options.limit)
        return {
          entries: limited,
          cursor: hasMore ? limited[limited.length - 1]?.key : undefined,
        }
      }

      return { entries }
    },

    vectorSearch(embedding: number[], options?: VectorSearchOptions): Promise<ScoredEntry[]> {
      return this.searchVectors!({
        dense: embedding,
        limit: options?.limit,
        threshold: options?.threshold,
        filter: options?.filter,
      })
    },

    async searchVectors(query: VectorSearchQuery): Promise<ScoredEntry[]> {
      if (!query.dense && !query.sparse) {
        throw new Error('searchVectors requires a dense or sparse query vector.')
      }

      let entries = activeEntries()
      if (query.filter) {
        entries = entries.filter((entry) => matchesFilter(entry.value, query.filter!))
      }

      const threshold = query.threshold ?? 0
      const scored = entries
        .map((entry) => {
          const denseEmbedding = Array.isArray(entry.value.embedding) ? (entry.value.embedding as number[]) : undefined
          const sparseEmbedding = isSparseVector(entry.value.sparseEmbedding)
            ? (entry.value.sparseEmbedding as SparseVector)
            : undefined

          const denseScore = query.dense && denseEmbedding ? cosineSimilarity(query.dense, denseEmbedding) : undefined
          const sparseScore =
            query.sparse && sparseEmbedding ? sparseCosineSimilarity(query.sparse, sparseEmbedding) : undefined
          const score = combineScores(denseScore, sparseScore)

          if (score === undefined || score < threshold) {
            return null
          }

          return { ...entry, score }
        })
        .filter((entry): entry is ScoredEntry => entry !== null)

      scored.sort((a, b) => b.score - a.score)
      return scored.slice(0, query.limit ?? 10)
    },

    subscribe(callback: (event: StoreEvent) => void): () => void {
      listeners.add(callback)
      return () => {
        listeners.delete(callback)
      }
    },

    supportsTtl(): boolean {
      return true
    },

    capabilities() {
      return {
        ttl: true,
        vectorSearch: { dense: true, sparse: true, hybrid: true },
        semanticCache: { isolatedVectorNamespace: true },
      }
    },
  }
}

function createMemoryDataStore(): DataStore {
  const data = new Map<string, JsonObject>()
  const expiry = new Map<string, number>()
  const listeners = new Set<(event: StoreEvent) => void>()

  function emit(event: StoreEvent): void {
    for (const listener of listeners) {
      listener(event)
    }
  }

  function activeEntries(): Array<{ key: string; value: JsonObject }> {
    const now = Date.now()
    const entries: Array<{ key: string; value: JsonObject }> = []

    for (const [key, value] of data.entries()) {
      const expiresAt = expiry.get(key)
      if (expiresAt !== undefined && now >= expiresAt) {
        data.delete(key)
        expiry.delete(key)
        continue
      }
      entries.push({ key, value: deepCopy(value) })
    }

    return entries
  }

  return {
    _tag: 'DataStore',
    async get(key: string): Promise<JsonObject | null> {
      const expiresAt = expiry.get(key)
      if (expiresAt !== undefined && Date.now() >= expiresAt) {
        data.delete(key)
        expiry.delete(key)
        return null
      }

      const value = data.get(key)
      return value ? deepCopy(value) : null
    },

    async set(key: string, value: JsonObject, options?: SetOptions): Promise<void> {
      data.set(key, deepCopy(value))
      if (options?.ttl !== undefined && options.ttl > 0) {
        expiry.set(key, Date.now() + options.ttl)
      } else {
        expiry.delete(key)
      }
      emit({ type: 'set', key, value: deepCopy(value), timestamp: Date.now() })
    },

    async delete(key: string): Promise<void> {
      data.delete(key)
      expiry.delete(key)
      emit({ type: 'delete', key, timestamp: Date.now() })
    },

    async list(prefix: string, options?: ListOptions): Promise<ListResult> {
      let entries = activeEntries().filter((entry) => entry.key.startsWith(prefix))

      if (options?.filter) {
        entries = entries.filter((entry) => matchesFilter(entry.value, options.filter!))
      }

      entries.sort((a, b) => {
        const aTime = typeof a.value.updatedAt === 'number' ? a.value.updatedAt : 0
        const bTime = typeof b.value.updatedAt === 'number' ? b.value.updatedAt : 0
        return bTime - aTime
      })

      if (options?.cursor) {
        const cursorIndex = entries.findIndex((entry) => entry.key === options.cursor)
        if (cursorIndex >= 0) {
          entries = entries.slice(cursorIndex + 1)
        }
      }

      if (options?.limit !== undefined && options.limit >= 0) {
        const hasMore = entries.length > options.limit
        const limited = entries.slice(0, options.limit)
        return {
          entries: limited,
          cursor: hasMore ? limited[limited.length - 1]?.key : undefined,
        }
      }

      return { entries }
    },

    subscribe(callback: (event: StoreEvent) => void): () => void {
      listeners.add(callback)
      return () => {
        listeners.delete(callback)
      }
    },

    supportsTtl(): boolean {
      return true
    },

    capabilities() {
      return {
        ttl: true,
        semanticCache: { isolatedVectorNamespace: true },
      }
    },
  }
}

function deepCopy(obj: JsonObject): JsonObject {
  return JSON.parse(JSON.stringify(obj))
}

function cloneVectorRecord(record: VectorRecord): VectorRecord {
  return {
    key: record.key,
    dense: record.dense ? [...record.dense] : undefined,
    sparse: record.sparse ? { indices: [...record.sparse.indices], values: [...record.sparse.values] } : undefined,
    metadata: record.metadata ? { ...record.metadata } : undefined,
  }
}

async function blobContentSize(content: BlobReadResult['content']): Promise<number> {
  if (typeof content === 'string') return new TextEncoder().encode(content).byteLength
  if (content instanceof Uint8Array) return content.byteLength
  if (typeof Blob !== 'undefined' && content instanceof Blob) return content.size
  return 0
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let index = 0; index < a.length; index++) {
    dotProduct += a[index] * b[index]
    normA += a[index] * a[index]
    normB += b[index] * b[index]
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB)
  if (denominator === 0) return 0
  return dotProduct / denominator
}

function sparseCosineSimilarity(a: SparseVector, b: SparseVector): number {
  const aMap = new Map<number, number>()
  for (let index = 0; index < a.indices.length; index++) {
    aMap.set(a.indices[index], a.values[index] ?? 0)
  }

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (const value of a.values) {
    normA += value * value
  }

  for (let index = 0; index < b.indices.length; index++) {
    const value = b.values[index] ?? 0
    normB += value * value
    dotProduct += (aMap.get(b.indices[index]) ?? 0) * value
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB)
  if (denominator === 0) return 0
  return dotProduct / denominator
}

function combineScores(denseScore?: number, sparseScore?: number): number | undefined {
  if (denseScore === undefined && sparseScore === undefined) {
    return undefined
  }
  if (denseScore === undefined) {
    return sparseScore
  }
  if (sparseScore === undefined) {
    return denseScore
  }
  return (denseScore + sparseScore) / 2
}

function isSparseVector(value: unknown): value is SparseVector {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<SparseVector>
  return Array.isArray(candidate.indices) && Array.isArray(candidate.values)
}
