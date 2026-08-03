import { StorageError } from '@use-crux/core/storage'
import type {
  ExactFilter,
  SearchFusion,
  SearchLeg,
  SearchLegKind,
  SearchQuery,
  SearchRecord,
  SearchStoreCapabilities,
  SparseVector,
} from '@use-crux/core/storage'

/** Upstash upsert payload after SearchStore records are validated. */
export interface UpstashSearchUpsertData {
  id: string
  vector?: number[]
  sparseVector?: SparseVector
  metadata?: Record<string, unknown>
}

/** Runtime-normalized search query ready for Upstash request shaping. */
export interface NormalizedSearchQuery {
  readonly legs: readonly NormalizedSearchLeg[]
  readonly fusion: SearchFusion
  readonly limit: number
  readonly threshold: number
  readonly filter?: ExactFilter
}

export type NormalizedSearchLeg =
  | { readonly kind: 'dense'; readonly vector: readonly number[]; readonly candidates: number }
  | { readonly kind: 'sparse'; readonly vector: SparseVector; readonly candidates: number }

/** Capability overrides for the configured Upstash index. */
export type UpstashSearchStoreCapabilityConfig = Omit<Partial<SearchStoreCapabilities>, 'legs'> & {
  readonly legs?: Partial<SearchStoreCapabilities['legs']>
}

/** Normalize optional adapter capabilities into a complete SearchStore capability set. */
export function normalizeCapabilities(config: UpstashSearchStoreCapabilityConfig | undefined): SearchStoreCapabilities {
  return {
    legs: {
      dense: config?.legs?.dense ?? true,
      sparse: config?.legs?.sparse ?? false,
      lexical: false,
    },
    fusion: normalizeCapabilityFusion(config?.fusion),
    filter: config?.filter ?? 'pre',
    consistency: config?.consistency ?? 'eventual',
  }
}

/** Validate and clone a SearchStore record before sending it to Upstash. */
export function normalizeUpsertRecord(
  record: SearchRecord,
  capabilities: SearchStoreCapabilities,
): UpstashSearchUpsertData {
  assertKey(record.key)
  const dense = record.dense === undefined ? undefined : cloneDenseVector(record.dense)
  const sparse = record.sparse === undefined ? undefined : cloneSparseVector(record.sparse)
  const metadata = record.metadata === undefined ? undefined : cloneExactFilter(record.metadata)
  if (!dense && !sparse) {
    throw new StorageError('invalid_value', 'Upstash SearchStore records require a dense or sparse vector.')
  }
  if (dense && !capabilities.legs.dense) {
    throw new StorageError('unsupported_capability', 'This Upstash SearchStore does not support dense records.')
  }
  if (sparse && !capabilities.legs.sparse) {
    throw new StorageError('unsupported_capability', 'This Upstash SearchStore does not support sparse records.')
  }
  return {
    id: record.key,
    ...(dense ? { vector: [...dense] } : {}),
    ...(sparse ? { sparseVector: sparse } : {}),
    ...(metadata ? { metadata } : {}),
  }
}

/** Validate and clone a SearchStore query before backend I/O. */
export function normalizeSearchQuery(
  query: SearchQuery,
  capabilities: SearchStoreCapabilities,
): NormalizedSearchQuery {
  const runtimeQuery = query as {
    readonly legs?: unknown
    readonly fusion?: unknown
    readonly limit?: unknown
    readonly threshold?: unknown
    readonly filter?: unknown
  }
  const limit = normalizeLimit(runtimeQuery.limit)
  const threshold = normalizeThreshold(runtimeQuery.threshold)
  const filter = runtimeQuery.filter === undefined ? undefined : cloneExactFilter(runtimeQuery.filter)
  if (filter && capabilities.filter !== 'pre') {
    throw new StorageError('unsupported_capability', 'This Upstash SearchStore does not support filtered search.')
  }
  const fusion = normalizeFusion(runtimeQuery.fusion, capabilities)
  const rawLegs = runtimeQuery.legs
  if (!Array.isArray(rawLegs) || rawLegs.length === 0 || rawLegs.length > 2) {
    throw new StorageError('invalid_value', 'Search queries require one dense leg, one sparse leg, or both.')
  }
  const seen = new Set<SearchLegKind>()
  const legs = rawLegs.map((leg) => normalizeLeg(leg, limit, capabilities))
  for (const leg of legs) {
    if (seen.has(leg.kind)) {
      throw new StorageError('invalid_value', 'Upstash SearchStore supports at most one leg per vector kind.')
    }
    seen.add(leg.kind)
  }
  if (legs.length > 1 && !capabilities.fusion.includes('rrf')) {
    throw new StorageError('unsupported_capability', 'This Upstash SearchStore does not support RRF fusion.')
  }
  return {
    legs,
    fusion,
    limit,
    threshold,
    ...(filter ? { filter } : {}),
  }
}

/** Strip adapter-private metadata fields and keep only exact-filter values. */
export function searchHitMetadata(metadata: Record<string, unknown>): ExactFilter | undefined {
  const entries = Object.entries(metadata).filter(
    ([key, value]) => key !== '_key' && isFilterValue(value),
  ) as [string, string | number | boolean | null][]
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function normalizeCapabilityFusion(value: readonly 'rrf'[] | undefined): readonly 'rrf'[] {
  if (value === undefined) return ['rrf']
  return value.includes('rrf') ? ['rrf'] : []
}

function normalizeFusion(value: unknown, capabilities: SearchStoreCapabilities): SearchFusion {
  if (value === undefined) return { strategy: 'rrf' }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new StorageError('invalid_value', 'Search fusion must be an object.')
  }
  const fusion = value as { readonly strategy?: unknown; readonly k?: unknown }
  if (fusion.strategy !== 'rrf') {
    throw new StorageError('unsupported_capability', 'Upstash SearchStore supports RRF fusion only.')
  }
  if (!capabilities.fusion.includes('rrf')) {
    throw new StorageError('unsupported_capability', 'This Upstash SearchStore does not support RRF fusion.')
  }
  if (fusion.k !== undefined && (typeof fusion.k !== 'number' || !Number.isInteger(fusion.k) || fusion.k <= 0)) {
    throw new StorageError('invalid_value', 'RRF fusion k must be a positive integer.')
  }
  return fusion.k === undefined ? { strategy: 'rrf' } : { strategy: 'rrf', k: fusion.k }
}

function normalizeLeg(
  value: unknown,
  limit: number,
  capabilities: SearchStoreCapabilities,
): NormalizedSearchLeg {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new StorageError('invalid_value', 'Search legs must be objects.')
  }
  const leg = value as SearchLeg
  if (leg.kind === 'dense') {
    if (!capabilities.legs.dense) {
      throw new StorageError('unsupported_capability', 'This Upstash SearchStore does not support dense search.')
    }
    return {
      kind: 'dense',
      vector: cloneDenseVector(leg.vector),
      candidates: normalizeCandidates(leg.candidates, limit),
    }
  }
  if (leg.kind === 'sparse') {
    if (!capabilities.legs.sparse) {
      throw new StorageError('unsupported_capability', 'This Upstash SearchStore does not support sparse search.')
    }
    return {
      kind: 'sparse',
      vector: cloneSparseVector(leg.vector),
      candidates: normalizeCandidates(leg.candidates, limit),
    }
  }
  if (leg.kind === 'lexical') {
    throw new StorageError('unsupported_capability', 'Upstash SearchStore does not support lexical search.')
  }
  throw new StorageError('invalid_value', 'Search leg kind must be dense, sparse, or lexical.')
}

function normalizeLimit(value: unknown): number {
  if (value === undefined) return 10
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new StorageError('invalid_value', 'Search limit must be a non-negative integer.')
  }
  return value
}

function normalizeCandidates(value: unknown, limit: number): number {
  if (value === undefined) return limit
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value < limit) {
    throw new StorageError('invalid_value', 'Search leg candidates must be a positive integer at least as large as limit.')
  }
  return value
}

function normalizeThreshold(value: unknown): number {
  if (value === undefined) return 0
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new StorageError('invalid_value', 'Search threshold must be a finite number.')
  }
  return value
}

function assertKey(key: string): void {
  if (key.length === 0) {
    throw new StorageError('invalid_key', 'Search keys must not be empty.')
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
    throw new StorageError('invalid_filter', 'Search filters must be plain objects.')
  }
  const filter: Record<string, string | number | boolean | null> = {}
  for (const [key, item] of Object.entries(value)) {
    if (key.includes('.') || !isFilterValue(item)) {
      throw new StorageError('invalid_filter', 'Search filters support exact top-level scalar equality only.')
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
