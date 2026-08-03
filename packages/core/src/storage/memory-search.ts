/**
 * Functional in-memory `SearchStore` implementation.
 *
 * The implementation validates query and record shapes, applies exact filters
 * before scoring, and uses deterministic normalized RRF for multi-leg queries.
 *
 * @module
 */

import { searchStoreCapabilities } from './capabilities'
import { StorageError } from './errors'
import { assertExactFilter, assertValidKey, cloneExactFilter, matchesExactFilter } from './memory-utils'
import type {
  ExactFilter,
  SearchHit,
  SearchLeg,
  SearchLegKind,
  SearchLegMatch,
  SearchQuery,
  SearchRecord,
  SearchStore,
  SparseVector,
} from './types'

interface StoredSearchRecord {
  readonly key: string
  readonly content?: string
  readonly dense?: readonly number[]
  readonly sparse?: SparseVector
  readonly metadata?: ExactFilter
}

interface NormalizedLegBase {
  readonly candidates: number
}

type NormalizedSearchLeg =
  | (NormalizedLegBase & { readonly kind: 'dense'; readonly vector: readonly number[] })
  | (NormalizedLegBase & { readonly kind: 'sparse'; readonly vector: SparseVector })
  | (NormalizedLegBase & { readonly kind: 'lexical'; readonly query: string })

interface NormalizedSearchQuery {
  readonly legs: readonly [NormalizedSearchLeg, ...NormalizedSearchLeg[]]
  readonly limit: number
  readonly threshold: number
  readonly filter?: ExactFilter
  readonly rrfK?: number
}

interface LegCandidate {
  readonly key: string
  readonly score: number
  readonly metadata?: ExactFilter
}

/** Create an in-memory search store for dense and sparse legs with RRF fusion. */
export function inMemorySearchStore(): SearchStore {
  const records = new Map<string, StoredSearchRecord>()
  const capabilities = searchStoreCapabilities({
    legs: { dense: true, sparse: true },
    filter: 'pre',
    consistency: 'strong',
  })

  return {
    _tag: 'SearchStore',
    async upsert(nextRecords) {
      const cloned = nextRecords.map(cloneSearchRecord)
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
      const normalized = normalizeSearchQuery(query, capabilities)
      if (normalized.limit === 0) return []
      const filtered = Array.from(records.values()).filter((record) =>
        normalized.filter ? matchesExactFilter(record.metadata, normalized.filter) : true,
      )
      const rankedLegs = normalized.legs.map((leg) => rankLeg(leg, filtered))
      const hits = normalized.legs.length === 1
        ? singleLegHits(rankedLegs[0] ?? [], normalized.legs[0]!.kind)
        : rrfHits(rankedLegs, normalized)
      return hits
        .filter((hit) => hit.score >= normalized.threshold)
        .sort((left, right) => right.score - left.score || left.key.localeCompare(right.key))
        .slice(0, normalized.limit)
        .map(cloneSearchHit)
    },
    capabilities: () => capabilities,
  }
}

function cloneSearchRecord(record: SearchRecord): StoredSearchRecord {
  assertValidKey(record.key)
  const content = record.content === undefined ? undefined : cloneContent(record.content)
  const dense = record.dense === undefined ? undefined : cloneDenseVector(record.dense)
  const sparse = record.sparse === undefined ? undefined : cloneSparseVector(record.sparse)
  if (content === undefined && dense === undefined && sparse === undefined) {
    throw new StorageError('invalid_value', 'Search records require content, dense, or sparse payload.')
  }
  return {
    key: record.key,
    ...(content !== undefined ? { content } : {}),
    ...(dense !== undefined ? { dense } : {}),
    ...(sparse !== undefined ? { sparse } : {}),
    ...(record.metadata ? { metadata: cloneFilter(record.metadata) } : {}),
  }
}

function normalizeSearchQuery(
  query: SearchQuery,
  capabilities: ReturnType<SearchStore['capabilities']>,
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
  const filter = runtimeQuery.filter === undefined ? undefined : cloneFilter(runtimeQuery.filter)
  if (!Array.isArray(runtimeQuery.legs) || runtimeQuery.legs.length === 0 || runtimeQuery.legs.length > 3) {
    throw new StorageError('invalid_value', 'Search query requires one to three legs.')
  }

  const seen = new Set<SearchLegKind>()
  const legs = runtimeQuery.legs.map((leg) => {
    const normalized = normalizeSearchLeg(leg, limit)
    if (seen.has(normalized.kind)) {
      throw new StorageError('invalid_value', `Search query includes duplicate ${normalized.kind} legs.`)
    }
    seen.add(normalized.kind)
    if (!capabilities.legs[normalized.kind]) {
      throw new StorageError('unsupported_capability', `SearchStore does not support ${normalized.kind} legs.`)
    }
    return normalized
  }) as [NormalizedSearchLeg, ...NormalizedSearchLeg[]]

  const fusion = normalizeFusion(runtimeQuery.fusion, legs.length)
  if (legs.length >= 2 && !capabilities.fusion.includes(fusion.strategy)) {
    throw new StorageError('unsupported_capability', `SearchStore does not support ${fusion.strategy} fusion.`)
  }
  if (filter && capabilities.filter !== 'pre') {
    throw new StorageError('unsupported_capability', 'SearchStore does not support pre-filtering.')
  }
  return {
    legs,
    limit,
    threshold,
    ...(filter ? { filter } : {}),
    ...(legs.length >= 2 ? { rrfK: fusion.k } : {}),
  }
}

function normalizeSearchLeg(value: unknown, limit: number): NormalizedSearchLeg {
  if (!value || typeof value !== 'object') {
    throw new StorageError('invalid_value', 'Search legs must be objects.')
  }
  const leg = value as SearchLeg
  const candidates = normalizeCandidates((value as { readonly candidates?: unknown }).candidates, limit)
  if (leg.kind === 'dense') {
    return { kind: 'dense', vector: cloneDenseVector((leg as { readonly vector?: unknown }).vector), candidates }
  }
  if (leg.kind === 'sparse') {
    return { kind: 'sparse', vector: cloneSparseVector((leg as { readonly vector?: unknown }).vector), candidates }
  }
  if (leg.kind === 'lexical') {
    return { kind: 'lexical', query: cloneLexicalQuery((leg as { readonly query?: unknown }).query), candidates }
  }
  throw new StorageError('invalid_value', 'Search leg kind must be dense, sparse, or lexical.')
}

function normalizeFusion(value: unknown, legCount: number): { readonly strategy: 'rrf'; readonly k: number } {
  if (legCount === 1) return { strategy: 'rrf', k: 60 }
  if (value === undefined) return { strategy: 'rrf', k: 60 }
  if (!value || typeof value !== 'object') {
    throw new StorageError('invalid_value', 'Search fusion must be an object.')
  }
  const fusion = value as { readonly strategy?: unknown; readonly k?: unknown }
  if (fusion.strategy !== 'rrf') {
    throw new StorageError('unsupported_capability', 'Search fusion strategy must be rrf.')
  }
  return { strategy: 'rrf', k: normalizeRrfK(fusion.k) }
}

function normalizeLimit(value: unknown): number {
  if (value === undefined) return 10
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new StorageError('invalid_value', 'Search limit must be a non-negative integer.')
  }
  return value
}

function normalizeCandidates(value: unknown, limit: number): number {
  if (value === undefined) return Math.max(limit, Math.min(1000, Math.max(50, 4 * limit)))
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new StorageError('invalid_value', 'Search leg candidates must be a positive integer.')
  }
  if (value < limit) {
    throw new StorageError('invalid_value', 'Search leg candidates must be at least the query limit.')
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

function normalizeRrfK(value: unknown): number {
  if (value === undefined) return 60
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new StorageError('invalid_value', 'Search RRF k must be a positive integer.')
  }
  return value
}

function cloneContent(value: unknown): string {
  if (typeof value !== 'string') {
    throw new StorageError('invalid_value', 'Search content must be a string.')
  }
  return value
}

function cloneLexicalQuery(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new StorageError('invalid_value', 'Lexical search query must be non-empty.')
  }
  return value
}

export function cloneDenseVector(value: unknown): readonly number[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every((item) => typeof item === 'number' && Number.isFinite(item))) {
    throw new StorageError('invalid_value', 'Dense vectors must be non-empty finite number arrays.')
  }
  return [...value]
}

export function cloneSparseVector(value: unknown): SparseVector {
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

function cloneFilter(value: unknown): ExactFilter {
  assertExactFilter(value)
  return { ...value }
}

function rankLeg(leg: NormalizedSearchLeg, records: readonly StoredSearchRecord[]): readonly LegCandidate[] {
  return records
    .flatMap((record) => {
      const score = scoreLeg(record, leg)
      if (score === undefined) return []
      const candidate: LegCandidate = {
        key: record.key,
        score,
        ...(record.metadata ? { metadata: record.metadata } : {}),
      }
      return [candidate]
    })
    .sort((left, right) => right.score - left.score || left.key.localeCompare(right.key))
    .slice(0, leg.candidates)
}

function scoreLeg(record: StoredSearchRecord, leg: NormalizedSearchLeg): number | undefined {
  if (leg.kind === 'dense') return record.dense ? cosineSimilarity(leg.vector, record.dense) : undefined
  if (leg.kind === 'sparse') return record.sparse ? sparseCosineSimilarity(leg.vector, record.sparse) : undefined
  if (!record.content) return undefined
  const terms = tokenize(leg.query)
  if (terms.length === 0) return undefined
  const contentTerms = tokenize(record.content)
  if (contentTerms.length === 0) return undefined
  const counts = new Map<string, number>()
  for (const term of contentTerms) counts.set(term, (counts.get(term) ?? 0) + 1)
  const matched = terms.reduce((sum, term) => sum + (counts.get(term) ?? 0), 0)
  return matched === 0 ? undefined : matched / contentTerms.length
}

function singleLegHits(candidates: readonly LegCandidate[], kind: SearchLegKind): SearchHit[] {
  return candidates.map((candidate, index) => ({
    key: candidate.key,
    score: candidate.score,
    ...(candidate.metadata ? { metadata: cloneExactFilter(candidate.metadata) } : {}),
    matches: [{ kind, rank: index + 1, score: candidate.score }],
  }))
}

function rrfHits(rankedLegs: readonly (readonly LegCandidate[])[], query: NormalizedSearchQuery): SearchHit[] {
  const byKey = new Map<string, { metadata?: ExactFilter; matches: SearchLegMatch[] }>()
  rankedLegs.forEach((candidates, legIndex) => {
    const kind = query.legs[legIndex]!.kind
    candidates.forEach((candidate, index) => {
      const current = byKey.get(candidate.key) ?? { matches: [] }
      byKey.set(candidate.key, {
        metadata: current.metadata ?? candidate.metadata,
        matches: [...current.matches, { kind, rank: index + 1, score: candidate.score }],
      })
    })
  })
  return Array.from(byKey.entries()).map(([key, value]) => ({
    key,
    score: rrfScore(value.matches, query.rrfK ?? 60, query.legs.length),
    ...(value.metadata ? { metadata: cloneExactFilter(value.metadata) } : {}),
    matches: value.matches.sort(
      (left, right) =>
        query.legs.findIndex((leg) => leg.kind === left.kind) -
        query.legs.findIndex((leg) => leg.kind === right.kind),
    ),
  }))
}

function rrfScore(matches: readonly SearchLegMatch[], k: number, legCount: number): number {
  return matches.reduce((sum, match) => sum + 1 / (k + match.rank), 0) * ((k + 1) / legCount)
}

function cloneSearchHit(hit: SearchHit): SearchHit {
  return {
    key: hit.key,
    score: hit.score,
    ...(hit.metadata ? { metadata: cloneExactFilter(hit.metadata) } : {}),
    matches: hit.matches.map((match) => ({ ...match })),
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

function tokenize(value: string): string[] {
  return value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
}

function isSparseVector(value: unknown): value is SparseVector {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { readonly indices?: unknown; readonly values?: unknown }
  return Array.isArray(candidate.indices) && Array.isArray(candidate.values)
}
