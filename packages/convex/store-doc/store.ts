/**
 * `CruxStore` implementation over the Convex store document I/O port.
 *
 * Adapter files provide local I/O functions. This module owns the higher-level
 * store behavior: TTL cleanup, filter consistency, vector hit shaping, and
 * capability reporting.
 *
 * @module
 */

import type {
  CruxStore,
  JsonObject,
  ListOptions,
  ListResult,
  ScoredEntry,
  SetOptions,
  StoreEntry,
  VectorSearchOptions,
  VectorSearchQuery,
} from '@crux/core/store'
import { createStoreDocCodec } from './codec'
import type { DecodedStoreDoc, StoreDocListResponse, StoreDocRecord, StoreDocStoreConfig } from './types'

/**
 * Create a `CruxStore` from a small adapter-local document I/O port.
 *
 * The returned store owns document serialization, TTL suppression and cleanup,
 * top-level filter semantics, dense vector result shaping, vector capability
 * reporting, and sparse/hybrid rejection. Convex-specific function references,
 * action contexts, and generated component APIs stay outside this module.
 */
export function createStoreDocStore<TDoc extends StoreDocRecord>(config: StoreDocStoreConfig<TDoc>): CruxStore {
  const codec = createStoreDocCodec({ now: config.now })
  const denseVectorSearch = Boolean(config.denseVectorSearch)

  async function cleanupExpired(decoded: readonly DecodedStoreDoc[]): Promise<void> {
    await Promise.all(
      decoded
        .filter((doc) => doc.expired)
        .map((doc) =>
          config.io.delete(doc.key).catch(() => {
            // Expiry cleanup is best-effort outside single-record get().
          }),
        ),
    )
  }

  async function searchVectors(query: VectorSearchQuery): Promise<ScoredEntry[]> {
    if (query.dense === undefined && query.sparse === undefined) {
      throw new Error('Convex searchVectors() requires a dense query vector.')
    }
    if (query.sparse !== undefined && query.dense !== undefined) {
      throw new Error('Convex cruxConvexStore does not support hybrid dense+sparse retrieval.')
    }
    if (query.sparse !== undefined) {
      throw new Error('Convex cruxConvexStore does not support sparse retrieval.')
    }
    if (query.dense === undefined || !config.io.searchDense || !denseVectorSearch) {
      return []
    }

    const docs = await config.io.searchDense({
      vector: query.dense,
      limit: query.limit ?? 10,
    })
    const decoded = docs.map((doc) => codec.decode(doc))
    await cleanupExpired(decoded)

    return decoded
      .filter((doc) => !doc.expired)
      .map(
        (doc): ScoredEntry => ({
          key: doc.key,
          value: doc.value,
          score: doc.score ?? 0,
        }),
      )
      .filter((entry) => query.threshold === undefined || entry.score >= query.threshold)
      .filter((entry) => codec.matchesFilter(entry.value, query.filter))
  }

  function vectorSearch(embedding: number[], options?: VectorSearchOptions): Promise<ScoredEntry[]> {
    return searchVectors({
      dense: embedding,
      limit: options?.limit,
      threshold: options?.threshold,
      filter: options?.filter,
    })
  }

  return {
    async get(key: string): Promise<JsonObject | null> {
      const doc = await config.io.get(key)
      if (!doc) return null
      const decoded = codec.decode(doc)
      if (decoded.expired) {
        await config.io.delete(decoded.key)
        return null
      }
      return decoded.value
    },

    async set(key: string, value: JsonObject, options?: SetOptions): Promise<void> {
      await config.io.put(codec.encode(key, value, options))
    },

    async delete(key: string): Promise<void> {
      await config.io.delete(key)
    },

    async list(prefix: string, options?: ListOptions): Promise<ListResult> {
      const response = normalizeListResponse(
        await config.io.list({
          prefix,
          limit: options?.limit,
          cursor: options?.cursor,
          filter: options?.filter,
        }),
      )
      const decoded = response.docs.map((doc) => codec.decode(doc))
      await cleanupExpired(decoded)

      const entries = decoded
        .filter((doc) => !doc.expired && codec.matchesFilter(doc.value, options?.filter))
        .map((doc): StoreEntry => ({ key: doc.key, value: doc.value }))

      return {
        entries,
        ...(response.cursor === undefined ? {} : { cursor: response.cursor }),
      }
    },

    vectorSearch,
    searchVectors,

    supportsTtl(): boolean {
      return true
    },

    capabilities() {
      return {
        ttl: true,
        vectorSearch: { dense: denseVectorSearch, sparse: false, hybrid: false },
        semanticCache: { isolatedVectorNamespace: Boolean(config.semanticCache?.isolatedVectorNamespace) },
      }
    },
  }
}

function normalizeListResponse<TDoc extends StoreDocRecord>(
  response: StoreDocListResponse<TDoc>,
): { docs: readonly TDoc[]; cursor?: string } {
  return isPagedListResponse(response) ? response : { docs: response }
}

function isPagedListResponse<TDoc extends StoreDocRecord>(
  response: StoreDocListResponse<TDoc>,
): response is { docs: readonly TDoc[]; cursor?: string } {
  return !Array.isArray(response)
}
