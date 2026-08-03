import { StorageError } from '@use-crux/core/storage'
import type {
  ExactFilter,
  JsonObject,
  JsonValue,
  RecordListOptions,
  RecordWriteOptions,
  SearchLegKind,
  SearchQuery,
  SearchRecord,
  SearchStoreCapabilities,
  SparseVector,
} from '@use-crux/core/storage'

export interface SearchPayloadOptions {
  readonly dimensions?: number
  readonly sparseDimensions?: number
  readonly lexical: boolean
}

export interface NormalizedSearchRecord {
  readonly key: string
  readonly content?: string
  readonly dense?: readonly number[]
  readonly sparse?: SparseVector
  readonly metadata: ExactFilter
}

export interface NormalizedSearchLeg {
  readonly kind: SearchLegKind
  readonly dense?: readonly number[]
  readonly sparse?: SparseVector
  readonly lexical?: string
  readonly candidates: number
}

export interface NormalizedSearchQuery {
  readonly legs: readonly NormalizedSearchLeg[]
  readonly fusion?: { readonly strategy: 'rrf'; readonly k: number }
  readonly limit: number
  readonly threshold: number
  readonly filter?: ExactFilter
}

export function assertSchema(schema: unknown): asserts schema is string {
  if (typeof schema !== 'string' || schema.length === 0 || schema.includes('\0')) {
    throw new StorageError('invalid_value', 'PostgreSQL storage schema must be a non-empty SQL identifier.')
  }
}

export function assertOptionalDimensions(value: unknown, label: string): asserts value is number | undefined {
  if (value !== undefined && (typeof value !== 'number' || !Number.isInteger(value) || value <= 0)) {
    throw new StorageError('invalid_value', `${label} must be a positive integer.`)
  }
}

export function assertDimensions(value: unknown, label: string): asserts value is number {
  assertOptionalDimensions(value, label)
  if (value === undefined) {
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

export function normalizeSearchRecord(record: SearchRecord, options: SearchPayloadOptions): NormalizedSearchRecord {
  assertKey(record.key, 'Search')
  const content = record.content === undefined ? undefined : cloneContent(record.content)
  const dense = record.dense === undefined ? undefined : cloneDense(record.dense, options.dimensions)
  const sparse = record.sparse === undefined ? undefined : cloneSparse(record.sparse, options.sparseDimensions)
  if (content === undefined && !dense && !sparse) {
    throw new StorageError('invalid_value', 'Search records require content, a dense payload, or a sparse payload.')
  }
  return {
    key: record.key,
    ...(content !== undefined ? { content } : {}),
    ...(dense ? { dense } : {}),
    ...(sparse ? { sparse } : {}),
    metadata: record.metadata === undefined ? {} : cloneExactFilter(record.metadata, 'Search'),
  }
}

export function normalizeSearchQuery(
  query: SearchQuery,
  options: SearchPayloadOptions,
  capabilities: SearchStoreCapabilities,
): NormalizedSearchQuery {
  const input = query as unknown as Record<string, unknown>
  const limit = normalizeLimit(input.limit)
  const threshold = normalizeThreshold(input.threshold)
  const filter = input.filter === undefined ? undefined : cloneExactFilter(input.filter, 'Search')
  if (!Array.isArray(input.legs) || input.legs.length < 1 || input.legs.length > 3) {
    throw new StorageError('invalid_value', 'Search queries require one to three legs.')
  }
  const seen = new Set<string>()
  const defaultCandidates = Math.max(limit, Math.min(1000, Math.max(50, 4 * limit)))
  const legs = input.legs.map((leg) => normalizeSearchLeg(leg, options, capabilities, limit, defaultCandidates, seen))
  const authoredFusion = input.fusion === undefined ? undefined : normalizeFusion(input.fusion, capabilities)
  const fusion = legs.length < 2 ? undefined : (authoredFusion ?? normalizeFusion(undefined, capabilities))
  return {
    legs,
    ...(fusion ? { fusion } : {}),
    limit,
    threshold,
    ...(filter ? { filter } : {}),
  }
}

export function sparsePayloadSql(vector: SparseVector, dimensions: number): string {
  const entries = vector.indices
    .map((index, position) => [index + 1, vector.values[position]!] as const)
    .sort(([left], [right]) => left - right)
    .map(([index, value]) => `${index}:${value}`)
  return `{${entries.join(',')}}/${dimensions}`
}

export function densePayloadSql(vector: readonly number[]): string {
  return `[${vector.join(',')}]`
}

function normalizeSearchLeg(
  value: unknown,
  options: SearchPayloadOptions,
  capabilities: SearchStoreCapabilities,
  limit: number,
  defaultCandidates: number,
  seen: Set<string>,
): NormalizedSearchLeg {
  if (!isPlainObject(value)) {
    throw new StorageError('invalid_value', 'Search legs must be plain objects.')
  }
  const kind = value.kind
  if (kind !== 'dense' && kind !== 'sparse' && kind !== 'lexical') {
    throw new StorageError('invalid_value', 'Search leg kind must be dense, sparse, or lexical.')
  }
  if (seen.has(kind)) {
    throw new StorageError('invalid_value', 'Search queries cannot contain duplicate leg kinds.')
  }
  seen.add(kind)
  if (!capabilities.legs[kind]) {
    throw new StorageError('unsupported_capability', `This PostgreSQL search store does not support ${kind} search.`)
  }
  const candidates = normalizeCandidates(value.candidates, limit, defaultCandidates)
  if (kind === 'dense') return { kind, dense: cloneDense(value.vector, options.dimensions), candidates }
  if (kind === 'sparse') return { kind, sparse: cloneSparse(value.vector, options.sparseDimensions), candidates }
  if (typeof value.query !== 'string' || value.query.length === 0) {
    throw new StorageError('invalid_value', 'Lexical search queries must be non-empty strings.')
  }
  return { kind, lexical: value.query, candidates }
}

function normalizeFusion(value: unknown, capabilities: SearchStoreCapabilities): { readonly strategy: 'rrf'; readonly k: number } {
  if (!capabilities.fusion.includes('rrf')) {
    throw new StorageError('unsupported_capability', 'This PostgreSQL search store does not support RRF fusion.')
  }
  if (value === undefined) return { strategy: 'rrf', k: 60 }
  if (!isPlainObject(value) || value.strategy !== 'rrf') {
    throw new StorageError('unsupported_capability', 'Unsupported PostgreSQL search fusion strategy.')
  }
  const k = value.k ?? 60
  if (typeof k !== 'number' || !Number.isInteger(k) || k <= 0) {
    throw new StorageError('invalid_value', 'RRF k must be a positive integer.')
  }
  return { strategy: 'rrf', k }
}

function normalizeCandidates(value: unknown, limit: number, fallback: number): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value < limit) {
    throw new StorageError('invalid_value', 'Search leg candidates must be a positive integer at least as large as limit.')
  }
  return value
}

function cloneContent(value: unknown): string {
  if (typeof value !== 'string') {
    throw new StorageError('invalid_value', 'Search record content must be a string.')
  }
  return value
}

function cloneDense(value: unknown, dimensions: number | undefined): readonly number[] {
  if (dimensions === undefined) {
    throw new StorageError('unsupported_capability', 'This PostgreSQL search store does not support dense payloads.')
  }
  if (!Array.isArray(value) || value.length !== dimensions || !value.every(isFiniteNumber)) {
    throw new StorageError('invalid_value', `Dense payloads must contain exactly ${dimensions} finite numbers.`)
  }
  return [...value]
}

function cloneSparse(value: unknown, dimensions: number | undefined): SparseVector {
  if (!isPlainObject(value) || !Array.isArray(value.indices) || !Array.isArray(value.values)) {
    throw new StorageError('invalid_value', 'Sparse payloads must include indices and values arrays.')
  }
  if (dimensions === undefined) {
    throw new StorageError('unsupported_capability', 'This PostgreSQL search store does not support sparse payloads.')
  }
  if (value.indices.length === 0 || value.indices.length !== value.values.length) {
    throw new StorageError('invalid_value', 'Sparse payload indices and values must be non-empty and equal length.')
  }
  const seen = new Set<number>()
  for (const index of value.indices) {
    if (!Number.isInteger(index) || index < 0 || index >= dimensions || seen.has(index)) {
      throw new StorageError(
        'invalid_value',
        `Sparse payload indices must be unique integers between 0 and ${dimensions - 1}.`,
      )
    }
    seen.add(index)
  }
  if (!value.values.every(isFiniteNumber)) {
    throw new StorageError('invalid_value', 'Sparse payload values must be finite numbers.')
  }
  return { indices: [...value.indices] as number[], values: [...value.values] as number[] }
}

function normalizeLimit(value: unknown): number {
  if (value === undefined) return 10
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new StorageError('invalid_value', 'Search limit must be a non-negative integer.')
  }
  return value
}

function normalizeThreshold(value: unknown): number {
  if (value === undefined) return 0
  if (!isFiniteNumber(value)) {
    throw new StorageError('invalid_value', 'Search threshold must be a finite number.')
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
