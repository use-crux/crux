/**
 * Upstash Vector-backed SearchStore for Crux storage adapters.
 *
 * This module owns raw Upstash vector-index interaction and adapts it to the
 * integrated SearchStore API.
 *
 * @module
 */

import { StorageError } from '@use-crux/core/storage'
import type {
  SearchHit,
  SearchLegKind,
  SearchQuery,
  SearchRecord,
  SearchStore,
  SparseVector,
} from '@use-crux/core/storage'
import { upstashFilter } from './vector-filter'
import {
  normalizeCapabilities,
  normalizeSearchQuery,
  normalizeUpsertRecord,
  searchHitMetadata,
  type NormalizedSearchLeg,
  type UpstashSearchStoreCapabilityConfig,
} from './search-store-contract'

interface UpstashQueryData {
  vector?: number[]
  sparseVector?: SparseVector
  topK: number
  includeMetadata?: boolean
  filter?: string
}

interface UpstashQueryResult {
  id: string | number
  score: number
  metadata?: Record<string, unknown>
}

/**
 * Structural shape of an `@upstash/vector` index.
 *
 * Both the SDK's root `Index` and `Index.namespace(...)` satisfy this shape.
 * The SDK accepts several input forms, so adapter code narrows to the smaller
 * request shapes in this module before making calls.
 */
export interface UpstashIndex {
  namespace(name: string): UpstashNamespace
  upsert(data: unknown): Promise<unknown>
  query(data: unknown): Promise<UpstashQueryResult[]>
  delete(ids: unknown): Promise<unknown>
}

/** Structural shape returned by `UpstashIndex.namespace(...)`. */
export interface UpstashNamespace {
  upsert(data: unknown): Promise<unknown>
  query(data: unknown): Promise<UpstashQueryResult[]>
  delete(ids: unknown): Promise<unknown>
}

/** Configuration for `upstashSearchStore()`. */
export interface UpstashSearchStoreConfig {
  /** Upstash Vector index instance. */
  index: UpstashIndex
  /** Namespace for this search store. */
  namespace: string
  /**
   * Capabilities for the configured Upstash index.
   *
   * Upstash index mode is deployment configuration, so apps may narrow dense
   * or sparse support when the backing index is not hybrid-capable.
   */
  capabilities?: UpstashSearchStoreCapabilityConfig
}

/** Create a standalone Crux `SearchStore` backed by Upstash Vector. */
export function upstashSearchStore(config: UpstashSearchStoreConfig): SearchStore {
  const ns = config.index.namespace(config.namespace)
  const capabilities = normalizeCapabilities(config.capabilities)

  return {
    _tag: 'SearchStore',
    async upsert(records: readonly SearchRecord[]): Promise<void> {
      if (records.length === 0) return
      const payload = records.map((record) => normalizeUpsertRecord(record, capabilities))
      try {
        await ns.upsert(payload)
      } catch (cause) {
        throw new StorageError('backend_error', 'Upstash Vector upsert failed.', { cause })
      }
    },

    async delete(keys: readonly string[]): Promise<void> {
      if (keys.length === 0) return
      try {
        await ns.delete([...keys])
      } catch (cause) {
        throw new StorageError('backend_error', 'Upstash Vector delete failed.', { cause })
      }
    },

    async search(query: SearchQuery): Promise<readonly SearchHit[]> {
      const normalized = normalizeSearchQuery(query, capabilities)
      if (normalized.limit === 0) return []
      const filter = upstashFilter(normalized.filter)
      const legResults = await Promise.all(
        normalized.legs.map(async (leg) => ({
          leg,
          results: await queryUpstash(ns, queryForLeg(leg, filter)),
        })),
      )
      const hits = fuseRrf(
        legResults.map(({ leg, results }) => ({ kind: leg.kind, results })),
        normalized.fusion.k ?? 60,
      )
      return hits
        .filter((hit) => hit.score >= normalized.threshold)
        .slice(0, normalized.limit)
    },

    capabilities() {
      return capabilities
    },
  }
}

function queryForLeg(leg: NormalizedSearchLeg, filter: string | undefined): UpstashQueryData {
  return {
    ...(leg.kind === 'dense' ? { vector: [...leg.vector] } : { sparseVector: leg.vector }),
    ...(filter ? { filter } : {}),
    topK: leg.candidates,
    includeMetadata: true,
  }
}

async function queryUpstash(ns: UpstashNamespace, request: UpstashQueryData): Promise<UpstashQueryResult[]> {
  try {
    return await ns.query(request)
  } catch (cause) {
    throw new StorageError('backend_error', 'Upstash Vector query failed.', { cause })
  }
}

function fuseRrf(
  legs: readonly { readonly kind: SearchLegKind; readonly results: readonly UpstashQueryResult[] }[],
  k: number,
): SearchHit[] {
  const byKey = new Map<string, {
    key: string
    score: number
    metadata?: ReturnType<typeof searchHitMetadata>
    matches: { kind: SearchLegKind; rank: number; score: number }[]
  }>()
  const maxScore = legs.length / (k + 1)
  for (const leg of legs) {
    leg.results.forEach((result, index) => {
      const key = String(result.id)
      const hit = byKey.get(key) ?? { key, score: 0, matches: [] }
      hit.score += 1 / (k + index + 1)
      hit.matches.push({ kind: leg.kind, rank: index + 1, score: result.score })
      if (result.metadata) {
        hit.metadata = searchHitMetadata(result.metadata)
      }
      byKey.set(key, hit)
    })
  }
  return [...byKey.values()]
    .map((hit) => ({
      key: hit.key,
      score: maxScore === 0 ? 0 : hit.score / maxScore,
      ...(hit.metadata ? { metadata: hit.metadata } : {}),
      matches: hit.matches.sort((a, b) => a.rank - b.rank || a.kind.localeCompare(b.kind)),
    }))
    .sort(compareHits)
}

function compareHits(a: SearchHit, b: SearchHit): number {
  if (b.score !== a.score) return b.score - a.score
  return a.key.localeCompare(b.key)
}

export { upstashFilter } from './vector-filter'
