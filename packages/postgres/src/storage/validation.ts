import { StorageError } from '@use-crux/core/storage'
import type {
  ExactFilter,
  JsonObject,
  JsonValue,
  RecordListOptions,
  RecordWriteOptions,
  SparseVector,
  VectorRecord,
  VectorSearchQuery,
  VectorStoreCapabilities,
} from '@use-crux/core/storage'

export interface NormalizedVectorRecord {
  readonly key: string
  readonly dense?: readonly number[]
  readonly sparse?: SparseVector
  readonly metadata: ExactFilter
}

export interface NormalizedVectorQuery {
  readonly mode: 'dense' | 'sparse' | 'hybrid'
  readonly dense?: readonly number[]
  readonly sparse?: SparseVector
  readonly fusion?: 'rrf'
  readonly limit: number
  readonly threshold: number
  readonly filter?: ExactFilter
}

export function assertSchema(schema: unknown): asserts schema is string {
  if (typeof schema !== 'string' || schema.length === 0 || schema.includes('\0')) {
    throw new StorageError('invalid_value', 'PostgreSQL storage schema must be a non-empty SQL identifier.')
  }
}

export function assertDimensions(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new StorageError('invalid_value', `${label} must be a positive integer.`)
  }
}

export function assertKey(key: unknown, label = 'Storage'): asserts key is string {
  if (typeof key !== 'string' || key.length === 0) {
    throw new StorageError('invalid_key', `${label} keys must not be empty.`)
  }
}

export function cloneJsonObject<T extends JsonObject>(value: unknown): T {
  assertJsonValue(value, new WeakSet())
  if (!isPlainObject(value)) {
    throw new StorageError('invalid_value', 'Record values must be JSON objects.')
  }
  return JSON.parse(JSON.stringify(value)) as T
}

export function cloneExactFilter(value: unknown, label: string): ExactFilter {
  if (!isPlainObject(value)) {
    throw new StorageError('invalid_filter', `${label} filters must be plain objects.`)
  }
  const filter: Record<string, string | number | boolean | null> = {}
  for (const [key, item] of Object.entries(value)) {
    if (key.includes('.') || !isFilterValue(item)) {
      throw new StorageError('invalid_filter', `${label} filters support exact top-level scalar equality only.`)
    }
    filter[key] = item
  }
  return filter
}

export function expiresAt(options?: RecordWriteOptions): Date | null {
  if (options?.ttlMs === undefined) return null
  if (
    typeof options.ttlMs !== 'number' ||
    !Number.isFinite(options.ttlMs) ||
    !Number.isInteger(options.ttlMs) ||
    options.ttlMs <= 0
  ) {
    throw new StorageError('invalid_value', 'Record TTL must be a positive integer number of milliseconds.')
  }
  return new Date(Date.now() + options.ttlMs)
}

export function normalizeListOptions(options?: RecordListOptions): {
  readonly limit: number
  readonly cursor?: string
  readonly filter?: ExactFilter
} {
  const limit = options?.limit ?? 100
  if (!Number.isInteger(limit) || limit < 0) {
    throw new StorageError('invalid_value', 'Record list limit must be a non-negative integer.')
  }
  if (options?.cursor !== undefined && typeof options.cursor !== 'string') {
    throw new StorageError('invalid_value', 'Record list cursor must be a string.')
  }
  return {
    limit,
    ...(options?.cursor !== undefined ? { cursor: options.cursor } : {}),
    ...(options?.filter !== undefined ? { filter: cloneExactFilter(options.filter, 'Record') } : {}),
  }
}

export function normalizeVectorRecord(
  record: VectorRecord,
  dimensions: number,
  sparseDimensions: number | undefined,
): NormalizedVectorRecord {
  assertKey(record.key, 'Vector')
  const dense = record.dense === undefined ? undefined : cloneDense(record.dense, dimensions)
  const sparse = record.sparse === undefined ? undefined : cloneSparse(record.sparse, sparseDimensions)
  if (!dense && !sparse) {
    throw new StorageError('invalid_value', 'Vector records require a dense or sparse vector.')
  }
  if (sparse && sparseDimensions === undefined) {
    throw new StorageError('unsupported_capability', 'This PostgreSQL vector store does not support sparse vectors.')
  }
  if (dense && sparse && sparseDimensions === undefined) {
    throw new StorageError('unsupported_capability', 'This PostgreSQL vector store does not support hybrid vectors.')
  }
  return {
    key: record.key,
    ...(dense ? { dense } : {}),
    ...(sparse ? { sparse } : {}),
    metadata: record.metadata === undefined ? {} : cloneExactFilter(record.metadata, 'Vector'),
  }
}

export function normalizeVectorQuery(
  query: VectorSearchQuery,
  dimensions: number,
  sparseDimensions: number | undefined,
  capabilities: VectorStoreCapabilities,
): NormalizedVectorQuery {
  const input = query as unknown as Record<string, unknown>
  const limit = normalizeLimit(input.limit)
  const threshold = normalizeThreshold(input.threshold)
  const filter = input.filter === undefined ? undefined : cloneExactFilter(input.filter, 'Vector')
  if (input.mode === 'dense') {
    return {
      mode: 'dense',
      dense: cloneDense(input.dense, dimensions),
      limit,
      threshold,
      ...(filter ? { filter } : {}),
    }
  }
  if (input.mode === 'sparse') {
    if (!capabilities.sparse)
      throw new StorageError('unsupported_capability', 'This PostgreSQL vector store does not support sparse search.')
    return {
      mode: 'sparse',
      sparse: cloneSparse(input.sparse, sparseDimensions),
      limit,
      threshold,
      ...(filter ? { filter } : {}),
    }
  }
  if (input.mode === 'hybrid') {
    if (!capabilities.hybrid)
      throw new StorageError('unsupported_capability', 'This PostgreSQL vector store does not support hybrid search.')
    if (input.fusion === 'dbsf')
      throw new StorageError('unsupported_capability', 'PostgreSQL vector storage does not support DBSF fusion.')
    if (input.fusion !== undefined && input.fusion !== 'rrf')
      throw new StorageError('unsupported_capability', 'Unsupported PostgreSQL vector fusion mode.')
    return {
      mode: 'hybrid',
      dense: cloneDense(input.dense, dimensions),
      sparse: cloneSparse(input.sparse, sparseDimensions),
      fusion: 'rrf',
      limit,
      threshold,
      ...(filter ? { filter } : {}),
    }
  }
  throw new StorageError('invalid_value', 'Vector search mode must be dense, sparse, or hybrid.')
}

export function sparseVectorSql(vector: SparseVector, dimensions: number): string {
  const entries = vector.indices
    .map((index, position) => [index + 1, vector.values[position]!] as const)
    .sort(([left], [right]) => left - right)
    .map(([index, value]) => `${index}:${value}`)
  return `{${entries.join(',')}}/${dimensions}`
}

export function denseVectorSql(vector: readonly number[]): string {
  return `[${vector.join(',')}]`
}

function cloneDense(value: unknown, dimensions: number): readonly number[] {
  if (!Array.isArray(value) || value.length !== dimensions || !value.every(isFiniteNumber)) {
    throw new StorageError('invalid_value', `Dense vectors must contain exactly ${dimensions} finite numbers.`)
  }
  return [...value]
}

function cloneSparse(value: unknown, dimensions: number | undefined): SparseVector {
  if (!isPlainObject(value) || !Array.isArray(value.indices) || !Array.isArray(value.values)) {
    throw new StorageError('invalid_value', 'Sparse vectors must include indices and values arrays.')
  }
  if (dimensions === undefined) {
    throw new StorageError('unsupported_capability', 'This PostgreSQL vector store does not support sparse vectors.')
  }
  if (value.indices.length === 0 || value.indices.length !== value.values.length) {
    throw new StorageError('invalid_value', 'Sparse vector indices and values must be non-empty and equal length.')
  }
  const seen = new Set<number>()
  for (const index of value.indices) {
    if (!Number.isInteger(index) || index < 0 || index >= dimensions || seen.has(index)) {
      throw new StorageError(
        'invalid_value',
        `Sparse vector indices must be unique integers between 0 and ${dimensions - 1}.`,
      )
    }
    seen.add(index)
  }
  if (!value.values.every(isFiniteNumber)) {
    throw new StorageError('invalid_value', 'Sparse vector values must be finite numbers.')
  }
  return { indices: [...value.indices] as number[], values: [...value.values] as number[] }
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
  if (!isFiniteNumber(value)) {
    throw new StorageError('invalid_value', 'Vector search threshold must be a finite number.')
  }
  return value
}

function assertJsonValue(value: unknown, ancestors: WeakSet<object>): asserts value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (isFiniteNumber(value)) return
  if (Array.isArray(value)) {
    assertNotCyclic(value, ancestors)
    value.forEach((item) => assertJsonValue(item, ancestors))
    ancestors.delete(value)
    return
  }
  if (isPlainObject(value)) {
    assertNotCyclic(value, ancestors)
    Object.values(value).forEach((item) => assertJsonValue(item, ancestors))
    ancestors.delete(value)
    return
  }
  throw new StorageError('invalid_value', 'Record values must be JSON serializable.')
}

function assertNotCyclic(value: object, ancestors: WeakSet<object>): void {
  if (ancestors.has(value)) {
    throw new StorageError('invalid_value', 'Record values must be JSON serializable.')
  }
  ancestors.add(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isFilterValue(value: unknown): value is ExactFilter[string] {
  return value === null || typeof value === 'string' || typeof value === 'boolean' || isFiniteNumber(value)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
