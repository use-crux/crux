/**
 * Functional in-memory `VectorStore` implementation.
 *
 * The implementation validates beta vector shapes, applies metadata filters
 * before scoring, and returns cloned hits so callers cannot mutate stored
 * metadata through search results.
 *
 * @module
 */

import { StorageError } from './errors'
import { assertExactFilter, assertValidKey, cloneExactFilter, matchesExactFilter } from './memory-utils'
import type { SparseVector, VectorHit, VectorRecord, VectorSearchQuery, VectorStore } from './types'

interface StoredVectorRecord {
  readonly key: string
  readonly dense?: readonly number[]
  readonly sparse?: SparseVector
  readonly metadata?: Record<string, string | number | boolean | null>
}

interface NormalizedVectorSearchQuery {
  readonly mode: 'dense' | 'sparse' | 'hybrid'
  readonly dense?: readonly number[]
  readonly sparse?: SparseVector
  readonly fusion?: 'rrf' | 'dbsf'
  readonly limit: number
  readonly threshold: number
  readonly filter?: Record<string, string | number | boolean | null>
}

/** Create an in-memory vector store for dense, sparse, and hybrid search. */
export function inMemoryVectorStore(): VectorStore {
  const records = new Map<string, StoredVectorRecord>()

  return {
    _tag: 'VectorStore',
    async upsert(nextRecords) {
      const cloned = nextRecords.map(cloneVectorRecord)
      for (const record of cloned) {
        records.set(record.key, record)
      }
    },
    async delete(keys) {
      for (const key of keys) {
        assertValidKey(key)
        records.delete(key)
      }
    },
    async search(query) {
      const normalized = normalizeVectorSearchQuery(query)
      if (normalized.fusion) {
        throw new StorageError('unsupported_capability', `Vector fusion mode "${normalized.fusion}" is not supported.`)
      }

      return Array.from(records.values())
        .filter((record) => (normalized.filter ? matchesExactFilter(record.metadata, normalized.filter) : true))
        .flatMap((record) => scoreRecord(record, normalized))
        .filter((hit) => hit.score >= normalized.threshold)
        .sort((left, right) => right.score - left.score || left.key.localeCompare(right.key))
        .slice(0, normalized.limit)
        .map(cloneVectorHit)
    },
    capabilities: () => ({
      dense: true,
      sparse: true,
      hybrid: true,
      fusion: [],
      filter: 'pre',
      consistency: 'strong',
    }),
  }
}

function cloneVectorRecord(record: VectorRecord): StoredVectorRecord {
  assertValidKey(record.key)
  const dense = record.dense ? cloneDenseVector(record.dense) : undefined
  const sparse = record.sparse ? cloneSparseVector(record.sparse) : undefined
  if (!dense && !sparse) {
    throw new StorageError('invalid_value', 'Vector records require a dense or sparse vector.')
  }
  return {
    key: record.key,
    ...(dense ? { dense } : {}),
    ...(sparse ? { sparse } : {}),
    ...(record.metadata ? { metadata: cloneExactFilter(record.metadata) } : {}),
  }
}

function normalizeVectorSearchQuery(query: VectorSearchQuery): NormalizedVectorSearchQuery {
  const runtimeQuery = query as {
    readonly mode?: unknown
    readonly dense?: unknown
    readonly sparse?: unknown
    readonly fusion?: unknown
    readonly limit?: unknown
    readonly threshold?: unknown
    readonly filter?: unknown
  }
  const mode = runtimeQuery.mode ?? inferLegacyMode(runtimeQuery.dense, runtimeQuery.sparse)
  const limit = normalizeLimit(runtimeQuery.limit)
  const threshold = normalizeThreshold(runtimeQuery.threshold)
  const filter = runtimeQuery.filter === undefined ? undefined : cloneFilter(runtimeQuery.filter)

  if (mode === 'dense') {
    return { mode, dense: cloneDenseVector(runtimeQuery.dense), limit, threshold, ...(filter ? { filter } : {}) }
  }
  if (mode === 'sparse') {
    return { mode, sparse: cloneSparseVector(runtimeQuery.sparse), limit, threshold, ...(filter ? { filter } : {}) }
  }
  if (mode === 'hybrid') {
    const fusion = normalizeFusion(runtimeQuery.fusion)
    return {
      mode,
      dense: cloneDenseVector(runtimeQuery.dense),
      sparse: cloneSparseVector(runtimeQuery.sparse),
      ...(fusion ? { fusion } : {}),
      limit,
      threshold,
      ...(filter ? { filter } : {}),
    }
  }

  throw new StorageError('invalid_value', 'Vector search mode must be dense, sparse, or hybrid.')
}

function inferLegacyMode(dense: unknown, sparse: unknown): NormalizedVectorSearchQuery['mode'] {
  if (dense !== undefined && sparse !== undefined) return 'hybrid'
  if (dense !== undefined) return 'dense'
  if (sparse !== undefined) return 'sparse'
  throw new StorageError('invalid_value', 'Vector search requires a dense or sparse query vector.')
}

function cloneDenseVector(value: unknown): readonly number[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every((item) => typeof item === 'number' && Number.isFinite(item))) {
    throw new StorageError('invalid_value', 'Dense vectors must be non-empty finite number arrays.')
  }
  return [...value]
}

function cloneSparseVector(value: unknown): SparseVector {
  if (!isSparseVector(value)) {
    throw new StorageError('invalid_value', 'Sparse vectors must include indices and values arrays.')
  }
  if (value.indices.length === 0 || value.indices.length !== value.values.length) {
    throw new StorageError('invalid_value', 'Sparse vector indices and values must be non-empty and equal length.')
  }

  const seen = new Set<number>()
  value.indices.forEach((index) => {
    if (!Number.isInteger(index) || index < 0 || seen.has(index)) {
      throw new StorageError('invalid_value', 'Sparse vector indices must be unique non-negative integers.')
    }
    seen.add(index)
  })
  if (!value.values.every((item) => typeof item === 'number' && Number.isFinite(item))) {
    throw new StorageError('invalid_value', 'Sparse vector values must be finite numbers.')
  }
  return {
    indices: [...value.indices],
    values: [...value.values],
  }
}

function cloneFilter(value: unknown): Record<string, string | number | boolean | null> {
  assertExactFilter(value)
  return { ...value }
}

function normalizeFusion(value: unknown): 'rrf' | 'dbsf' | undefined {
  if (value === undefined) return undefined
  if (value === 'rrf' || value === 'dbsf') return value
  throw new StorageError('unsupported_capability', 'Unsupported vector fusion mode.')
}

function normalizeLimit(value: unknown): number {
  if (value === undefined) return 10
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new StorageError('invalid_value', 'Vector search limit must be a non-negative integer.')
  }
  return value
}

function normalizeThreshold(value: unknown): number {
  if (value === undefined) return 0
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new StorageError('invalid_value', 'Vector search threshold must be a finite number.')
  }
  return value
}

function scoreRecord(record: StoredVectorRecord, query: NormalizedVectorSearchQuery): readonly VectorHit[] {
  const denseScore = query.dense && record.dense ? cosineSimilarity(query.dense, record.dense) : undefined
  const sparseScore = query.sparse && record.sparse ? sparseCosineSimilarity(query.sparse, record.sparse) : undefined
  const score = combineScores(denseScore, sparseScore)
  if (score === undefined) return []
  return [
    {
      key: record.key,
      score,
      ...(record.metadata ? { metadata: cloneExactFilter(record.metadata) } : {}),
    },
  ]
}

function cloneVectorHit(hit: VectorHit): VectorHit {
  return {
    key: hit.key,
    score: hit.score,
    ...(hit.metadata ? { metadata: cloneExactFilter(hit.metadata) } : {}),
  }
}

function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length) return 0
  const dotProduct = left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0)
  const leftNorm = Math.sqrt(left.reduce((sum, value) => sum + value * value, 0))
  const rightNorm = Math.sqrt(right.reduce((sum, value) => sum + value * value, 0))
  const denominator = leftNorm * rightNorm
  return denominator === 0 ? 0 : dotProduct / denominator
}

function sparseCosineSimilarity(left: SparseVector, right: SparseVector): number {
  const leftValues = new Map(left.indices.map((index, position) => [index, left.values[position] ?? 0]))
  const dotProduct = right.indices.reduce(
    (sum, index, position) => sum + (leftValues.get(index) ?? 0) * (right.values[position] ?? 0),
    0,
  )
  const leftNorm = Math.sqrt(left.values.reduce((sum, value) => sum + value * value, 0))
  const rightNorm = Math.sqrt(right.values.reduce((sum, value) => sum + value * value, 0))
  const denominator = leftNorm * rightNorm
  return denominator === 0 ? 0 : dotProduct / denominator
}

function combineScores(denseScore: number | undefined, sparseScore: number | undefined): number | undefined {
  if (denseScore === undefined) return sparseScore
  if (sparseScore === undefined) return denseScore
  return (denseScore + sparseScore) / 2
}

function isSparseVector(value: unknown): value is SparseVector {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { readonly indices?: unknown; readonly values?: unknown }
  return Array.isArray(candidate.indices) && Array.isArray(candidate.values)
}
