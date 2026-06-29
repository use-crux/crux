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
} from '@use-crux/core/store'
import { createStoreDocCodec } from './codec'
import type { DecodedStoreDoc, StoreDocPage, StoreDocPageQuery, StoreDocRecord, StoreDocStoreConfig } from './types'

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

  async function readListPage(query: StoreDocPageQuery): Promise<StoreDocPage<TDoc>> {
    return config.io.list(withoutUndefined(query))
  }

  async function decodeListPage(
    page: StoreDocPage<TDoc>,
    options?: Pick<ListOptions, 'filter'>,
  ): Promise<StoreEntry[]> {
    const decoded = page.docs.map((doc) => codec.decode(doc))
    await cleanupExpired(decoded)
    return decoded
      .filter((doc) => !doc.expired && codec.matchesFilter(doc.value, options?.filter))
      .map((doc): StoreEntry => ({ key: doc.key, value: doc.value }))
  }

  async function listEntries(prefix: string, options?: ListOptions): Promise<ListResult> {
    if (options?.limit !== undefined && options.limit <= 0) {
      return { entries: [] }
    }

    const target = options?.limit
    const entries: StoreEntry[] = []
    let cursor = options?.cursor
    let nextCursor: string | undefined

    do {
      const remaining = target === undefined ? undefined : target - entries.length
      const page = await readListPage({
        prefix,
        ...(remaining === undefined ? {} : { limit: remaining }),
        ...(cursor === undefined ? {} : { cursor }),
      })
      entries.push(...(await decodeListPage(page, options)))
      nextCursor = page.cursor

      if (target === undefined || entries.length >= target || nextCursor === undefined) {
        return {
          entries: target === undefined ? entries : entries.slice(0, target),
          ...(nextCursor === undefined ? {} : { cursor: nextCursor }),
        }
      }

      cursor = nextCursor
    } while (true)
  }

  async function searchVectors(query: VectorSearchQuery): Promise<ScoredEntry[]> {
    if (query.dense === undefined && query.sparse === undefined) {
      throw new Error('Convex searchVectors() requires a dense query vector.')
    }
    if (query.sparse !== undefined && query.dense !== undefined) {
      throw new Error('Convex store document contract does not support hybrid dense+sparse retrieval.')
    }
    if (query.sparse !== undefined) {
      throw new Error('Convex store document contract does not support sparse retrieval.')
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

    async setIfAbsent(key: string, value: JsonObject, options?: SetOptions): Promise<boolean> {
      return config.io.insert(codec.encode(key, value, options))
    },

    async delete(key: string): Promise<void> {
      await config.io.delete(key)
    },

    async list(prefix: string, options?: ListOptions): Promise<ListResult> {
      return listEntries(prefix, options)
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

function withoutUndefined<TQuery extends StoreDocPageQuery>(query: TQuery): StoreDocPageQuery {
  return {
    prefix: query.prefix,
    ...(query.limit === undefined ? {} : { limit: query.limit }),
    ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
  }
}
