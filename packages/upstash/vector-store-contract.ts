import { StorageError } from '@use-crux/core/storage'
import type {
  ExactFilter,
  SparseVector,
  VectorRecord,
  VectorSearchQuery,
  VectorStoreCapabilities,
} from '@use-crux/core/storage'

/** Upstash upsert payload after beta vector records are validated. */
export interface UpstashVectorUpsertData {
  id: string
  vector?: number[]
  sparseVector?: SparseVector
  metadata?: Record<string, unknown>
}

/** Runtime-normalized vector search query ready for Upstash request shaping. */
export interface NormalizedVectorSearchQuery {
  readonly mode: 'dense' | 'sparse' | 'hybrid'
  readonly dense?: readonly number[]
  readonly sparse?: SparseVector
  readonly fusion?: 'rrf' | 'dbsf'
  readonly limit: number
  readonly threshold: number
  readonly filter?: ExactFilter
}

/** Normalize optional adapter capabilities into a complete beta capability set. */
export function normalizeCapabilities(config: Partial<VectorStoreCapabilities> | undefined): VectorStoreCapabilities {
  return {
    dense: config?.dense ?? true,
    sparse: config?.sparse ?? false,
    hybrid: config?.hybrid ?? false,
    fusion: config?.fusion ?? [],
    filter: config?.filter ?? 'pre',
    consistency: config?.consistency ?? 'eventual',
  }
}

/** Validate and clone a beta vector record before sending it to Upstash. */
export function normalizeUpsertRecord(
  record: VectorRecord,
  capabilities: VectorStoreCapabilities,
): UpstashVectorUpsertData {
  assertKey(record.key)
  const dense = record.dense === undefined ? undefined : cloneDenseVector(record.dense)
  const sparse = record.sparse === undefined ? undefined : cloneSparseVector(record.sparse)
  const metadata = record.metadata === undefined ? undefined : cloneExactFilter(record.metadata)
  if (!dense && !sparse) {
    throw new StorageError('invalid_value', 'Upstash Vector records require a dense or sparse vector.')
  }
  if (dense && !capabilities.dense) {
    throw new StorageError('unsupported_capability', 'This Upstash Vector store does not support dense vectors.')
  }
  if (sparse && !capabilities.sparse) {
    throw new StorageError('unsupported_capability', 'This Upstash Vector store does not support sparse vectors.')
  }
  if (dense && sparse && !capabilities.hybrid) {
    throw new StorageError('unsupported_capability', 'This Upstash Vector store does not support hybrid vectors.')
  }
  return {
    id: record.key,
    ...(dense ? { vector: [...dense] } : {}),
    ...(sparse ? { sparseVector: sparse } : {}),
    ...(metadata ? { metadata } : {}),
  }
}

/** Validate and clone a beta vector search query before backend I/O. */
export function normalizeSearchQuery(
  query: VectorSearchQuery,
  capabilities: VectorStoreCapabilities,
): NormalizedVectorSearchQuery {
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
  const filter = runtimeQuery.filter === undefined ? undefined : cloneExactFilter(runtimeQuery.filter)

  if (mode === 'dense') {
    if (!capabilities.dense) {
      throw new StorageError('unsupported_capability', 'This Upstash Vector store does not support dense search.')
    }
    return { mode, dense: cloneDenseVector(runtimeQuery.dense), limit, threshold, ...(filter ? { filter } : {}) }
  }
  if (mode === 'sparse') {
    if (!capabilities.sparse) {
      throw new StorageError('unsupported_capability', 'This Upstash Vector store does not support sparse search.')
    }
    return { mode, sparse: cloneSparseVector(runtimeQuery.sparse), limit, threshold, ...(filter ? { filter } : {}) }
  }
  if (mode === 'hybrid') {
    if (!capabilities.hybrid) {
      throw new StorageError('unsupported_capability', 'This Upstash Vector store does not support hybrid search.')
    }
    const fusion = normalizeFusion(runtimeQuery.fusion, capabilities)
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

/** Strip adapter-private metadata fields and keep only beta exact-filter values. */
export function vectorHitMetadata(metadata: Record<string, unknown>): ExactFilter | undefined {
  const entries = Object.entries(metadata).filter(
    ([key, value]) => key !== '_key' && isFilterValue(value),
  ) as [string, string | number | boolean | null][]
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function inferLegacyMode(dense: unknown, sparse: unknown): NormalizedVectorSearchQuery['mode'] {
  if (dense !== undefined && sparse !== undefined) return 'hybrid'
  if (dense !== undefined) return 'dense'
  if (sparse !== undefined) return 'sparse'
  throw new StorageError('invalid_value', 'Vector search requires a dense or sparse query vector.')
}

function normalizeFusion(value: unknown, capabilities: VectorStoreCapabilities): 'rrf' | 'dbsf' | undefined {
  if (value === undefined) return undefined
  if (value !== 'rrf' && value !== 'dbsf') {
    throw new StorageError('unsupported_capability', 'Unsupported Upstash Vector fusion mode.')
  }
  if (!capabilities.fusion.includes(value)) {
    throw new StorageError('unsupported_capability', `Upstash Vector fusion mode "${value}" is not supported.`)
  }
  return value
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

function assertKey(key: string): void {
  if (key.length === 0) {
    throw new StorageError('invalid_key', 'Vector keys must not be empty.')
  }
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
  for (const index of value.indices) {
    if (!Number.isInteger(index) || index < 0 || seen.has(index)) {
      throw new StorageError('invalid_value', 'Sparse vector indices must be unique non-negative integers.')
    }
    seen.add(index)
  }
  if (!value.values.every((item) => typeof item === 'number' && Number.isFinite(item))) {
    throw new StorageError('invalid_value', 'Sparse vector values must be finite numbers.')
  }
  return { indices: [...value.indices], values: [...value.values] }
}

function cloneExactFilter(value: unknown): ExactFilter {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new StorageError('invalid_filter', 'Vector filters must be plain objects.')
  }
  const filter: Record<string, string | number | boolean | null> = {}
  for (const [key, item] of Object.entries(value)) {
    if (key.includes('.') || !isFilterValue(item)) {
      throw new StorageError('invalid_filter', 'Vector filters support exact top-level scalar equality only.')
    }
    filter[key] = item
  }
  return filter
}

function isSparseVector(value: unknown): value is SparseVector {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { readonly indices?: unknown; readonly values?: unknown }
  return Array.isArray(candidate.indices) && Array.isArray(candidate.values)
}

function isFilterValue(value: unknown): value is ExactFilter[string] {
  return (
    value === null ||
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value)) ||
    typeof value === 'boolean'
  )
}
