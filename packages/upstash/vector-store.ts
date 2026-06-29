/**
 * Upstash Vector capability for Crux storage adapters.
 *
 * This module owns raw Upstash vector-index interaction. The memory store in
 * `index.ts` composes it with Convex document persistence for hydrated reads.
 *
 * @module
 */

import type { SparseVector, VectorSearchQuery } from '@use-crux/core/store'
import type { VectorHit, VectorRecord, VectorStore } from '@use-crux/core/storage'

interface UpstashUpsertData {
  id: string
  vector?: number[]
  sparseVector?: SparseVector
  metadata?: Record<string, unknown>
}

interface UpstashQueryData {
  vector?: number[]
  sparseVector?: SparseVector
  topK: number
  includeMetadata?: boolean
  filter?: string
  fusion?: 'rrf' | 'dbsf'
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

/** Configuration for `upstashVectorStore()`. */
export interface UpstashVectorStoreConfig {
  /** Upstash Vector index instance. */
  index: UpstashIndex
  /** Namespace for this vector store. */
  namespace: string
}

/** Create a standalone Crux `VectorStore` backed by Upstash Vector. */
export function upstashVectorStore(config: UpstashVectorStoreConfig): VectorStore {
  const ns = config.index.namespace(config.namespace)

  return {
    _tag: 'VectorStore',
    async upsert(records: readonly VectorRecord[]): Promise<void> {
      if (records.length === 0) return
      await ns.upsert(
        records.map(
          (record) =>
            ({
              id: record.key,
              ...(record.dense ? { vector: record.dense } : {}),
              ...(record.sparse ? { sparseVector: record.sparse } : {}),
              ...(record.metadata
                ? { metadata: { ...record.metadata, _key: record.key } }
                : { metadata: { _key: record.key } }),
            }) satisfies UpstashUpsertData,
        ),
      )
    },

    async delete(keys: readonly string[]): Promise<void> {
      if (keys.length === 0) return
      await ns.delete([...keys])
    },

    async search(query: VectorSearchQuery): Promise<readonly VectorHit[]> {
      if (!query.dense && !query.sparse) {
        throw new Error('upstashVectorStore.search() requires a dense or sparse query vector.')
      }

      const filter = upstashFilter(query.filter)
      const results = await ns.query({
        ...(query.dense ? { vector: query.dense } : {}),
        ...(query.sparse ? { sparseVector: query.sparse } : {}),
        ...(query.fusion ? { fusion: query.fusion } : {}),
        ...(filter ? { filter } : {}),
        topK: query.limit ?? 10,
        includeMetadata: true,
      } satisfies UpstashQueryData)

      return results
        .filter((result) => query.threshold === undefined || result.score >= query.threshold)
        .map((result) => ({
          key: (result.metadata?._key as string | undefined) ?? String(result.id),
          score: result.score,
          ...(result.metadata ? { metadata: result.metadata } : {}),
        }))
    },

    capabilities() {
      return { dense: true, sparse: true, hybrid: true, fusion: ['rrf', 'dbsf'] as const }
    },
  }
}

export function upstashFilter(filter: Record<string, unknown> | undefined): string | undefined {
  if (!filter) return undefined
  const clauses = Object.entries(filter).flatMap(([key, value]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return []
    const encoded = encodeFilterValue(value)
    return encoded ? [`${key} = ${encoded}`] : []
  })
  return clauses.length > 0 ? clauses.join(' and ') : undefined
}

function encodeFilterValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return `'${value.replace(/'/g, "''")}'`
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }
  if (value === null) {
    return 'null'
  }
  return undefined
}
