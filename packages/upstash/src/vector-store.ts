/**
 * Upstash Vector capability for Crux storage adapters.
 *
 * This module owns raw Upstash vector-index interaction. The memory store in
 * `index.ts` composes it with Convex document persistence for hydrated reads.
 *
 * @module
 */

import { StorageError } from '@use-crux/core/storage'
import type {
  SparseVector,
  VectorHit,
  VectorRecord,
  VectorSearchQuery,
  VectorStore,
  VectorStoreCapabilities,
} from '@use-crux/core/storage'
import { upstashFilter } from './vector-filter'
import {
  normalizeCapabilities,
  normalizeSearchQuery,
  normalizeUpsertRecord,
  vectorHitMetadata,
} from './vector-store-contract'

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
  /**
   * Capabilities for the configured Upstash index.
   *
   * Upstash index mode is deployment configuration, so the adapter defaults to
   * dense-only search and lets apps opt into sparse or hybrid behavior when the
   * backing index is known to support it.
   */
  capabilities?: Partial<VectorStoreCapabilities>
}

/** Create a standalone Crux `VectorStore` backed by Upstash Vector. */
export function upstashVectorStore(config: UpstashVectorStoreConfig): VectorStore {
  const ns = config.index.namespace(config.namespace)
  const capabilities = normalizeCapabilities(config.capabilities)

  return {
    _tag: 'VectorStore',
    async upsert(records: readonly VectorRecord[]): Promise<void> {
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

    async search(query: VectorSearchQuery): Promise<readonly VectorHit[]> {
      const normalized = normalizeSearchQuery(query, capabilities)
      const filter = upstashFilter(normalized.filter)
      const request = {
        ...(normalized.dense ? { vector: [...normalized.dense] } : {}),
        ...(normalized.sparse ? { sparseVector: normalized.sparse } : {}),
        ...(normalized.fusion ? { fusion: normalized.fusion } : {}),
        ...(filter ? { filter } : {}),
        topK: normalized.limit,
        includeMetadata: true,
      } satisfies UpstashQueryData
      const results = await queryUpstash(ns, request)

      return results
        .filter((result) => result.score >= normalized.threshold)
        .map((result) => ({
          key: String(result.id),
          score: result.score,
          ...(result.metadata ? { metadata: vectorHitMetadata(result.metadata) } : {}),
        }))
    },

    capabilities() {
      return capabilities
    },
  }
}

async function queryUpstash(ns: UpstashNamespace, request: UpstashQueryData): Promise<UpstashQueryResult[]> {
  try {
    return await ns.query(request)
  } catch (cause) {
    throw new StorageError('backend_error', 'Upstash Vector query failed.', { cause })
  }
}

export { upstashFilter } from './vector-filter'
