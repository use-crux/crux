/**
 * `@use-crux/upstash` - Upstash storage adapters for Crux.
 *
 * Exposes Storage Beta adapters for Upstash Vector and Redis, plus the legacy
 * combined Convex + Upstash store for callers that have not migrated yet.
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
  SparseVector,
  StoreEntry,
  VectorSearchOptions,
  VectorSearchQuery,
} from '@use-crux/core/store'
import { matchesFilter } from '@use-crux/core/store'
import { toStoreValue } from '@use-crux/core/memory'
import type { RawMemoryDocument } from '@use-crux/core/memory'
import { normalizeListPage } from './convex-list-page'
export { upstashRedisRecordStore } from './redis-record-store'
export type { RedisRecordClient, RedisSubscriber, UpstashRedisRecordStoreConfig } from './redis-record-store'
import { upstashFilter, upstashVectorStore } from './vector-store'
import type { UpstashIndex, UpstashVectorStoreConfig } from './vector-store'

export { upstashVectorStore }
export type { UpstashIndex, UpstashVectorStoreConfig }

/**
 * Minimal Convex context shape. Convex's strongly-typed
 * `runQuery/runMutation` references trigger `TS2589: type instantiation
 * too deep` at the boundary, so we accept the documented bridge here.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Convex FunctionReference generics too deep — see backend/CLAUDE.md
interface ConvexContext {
  runQuery: (fn: any, args: any) => Promise<any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
  runMutation: (fn: any, args: any) => Promise<any>
}

/** Reference to a Convex function — see notes on `ConvexContext`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Convex FunctionReference bridge
type FnRef = ((...args: any[]) => any) | { _type?: string; _args?: unknown; _returnType?: unknown }

interface ConvexMemoryFns {
  get: FnRef
  set: FnRef
  insert: FnRef
  delete: FnRef
  list: FnRef
}

export interface UpstashMemoryStoreConfig {
  /** Upstash Vector index instance. */
  index: UpstashIndex
  /** Namespace for this store. */
  namespace: string
  /** Convex ctx + fns for CRUD persistence. */
  convex: {
    ctx: ConvexContext
    fns: ConvexMemoryFns
  }
  /** Optional sparse vector generator for hybrid indexes. */
  sparseEmbed?: (text: string) => SparseVector
  /** Declare this store namespace is dedicated to semantic cache entries. */
  semanticCache?: {
    isolatedVectorNamespace?: boolean
  }
}

export function cruxUpstashStore(config: UpstashMemoryStoreConfig): CruxStore {
  const { index, namespace, convex, sparseEmbed } = config
  const ns = index.namespace(namespace)
  const { ctx, fns } = convex

  return {
    async get(key: string): Promise<JsonObject | null> {
      const doc: RawMemoryDocument | null = await ctx.runQuery(fns.get, { key })
      if (!doc) return null

      const value = decodeStoredValue(doc)
      if (typeof value._expiresAt === 'number' && Date.now() >= value._expiresAt) {
        await Promise.all([ctx.runMutation(fns.delete, { key }), ns.delete(key).catch(() => {})])
        return null
      }

      return value
    },

    async set(key: string, value: JsonObject, options?: SetOptions): Promise<void> {
      const now = Date.now()
      const stored = options?.ttl !== undefined && options.ttl > 0 ? { ...value, _expiresAt: now + options.ttl } : value

      await ctx.runMutation(fns.set, {
        key,
        content: JSON.stringify(stored),
        metadata: { _cruxDoc: true },
        updatedAt: now,
      })

      const denseVector = value.embedding as number[] | undefined
      const content = (value.content as string) ?? ''
      const sparseVector =
        (value.sparseEmbedding as SparseVector | undefined) ?? (sparseEmbed ? sparseEmbed(content) : undefined)

      if (denseVector || sparseVector) {
        await ns.upsert({
          id: key,
          ...(denseVector ? { vector: denseVector } : {}),
          ...(sparseVector ? { sparseVector } : {}),
          metadata: vectorMetadata(key, value),
        })
      }
    },

    async setIfAbsent(key: string, value: JsonObject, options?: SetOptions): Promise<boolean> {
      const now = Date.now()
      const stored = options?.ttl !== undefined && options.ttl > 0 ? { ...value, _expiresAt: now + options.ttl } : value
      const inserted = await ctx.runMutation(fns.insert, {
        key,
        content: JSON.stringify(stored),
        metadata: { _cruxDoc: true },
        updatedAt: now,
      })

      if (!inserted) {
        return false
      }

      const denseVector = value.embedding as number[] | undefined
      const content = (value.content as string) ?? ''
      const sparseVector =
        (value.sparseEmbedding as SparseVector | undefined) ?? (sparseEmbed ? sparseEmbed(content) : undefined)

      if (denseVector || sparseVector) {
        await ns.upsert({
          id: key,
          ...(denseVector ? { vector: denseVector } : {}),
          ...(sparseVector ? { sparseVector } : {}),
          metadata: vectorMetadata(key, value),
        })
      }

      return true
    },

    async delete(key: string): Promise<void> {
      await Promise.all([
        ctx.runMutation(fns.delete, { key }),
        ns.delete(key).catch(() => {}),
      ])
    },

    async list(prefix: string, options?: ListOptions): Promise<ListResult> {
      if (options?.limit !== undefined && options.limit <= 0) {
        return { entries: [] }
      }

      const target = options?.limit
      const entries: StoreEntry[] = []
      let cursor = options?.cursor
      let nextCursor: string | undefined

      do {
        const remaining = target === undefined ? undefined : target - entries.length
        const page = normalizeListPage(
          await ctx.runQuery(fns.list, {
            prefix,
            ...(remaining === undefined ? {} : { limit: remaining }),
            ...(cursor === undefined ? {} : { cursor }),
          }),
        )

        const now = Date.now()
        for (const doc of page.docs) {
          const entry = {
            key: doc.key,
            value: decodeStoredValue(doc),
          }
          const expiresAt =
            typeof entry.value._expiresAt === 'number'
              ? entry.value._expiresAt
              : (entry.value.metadata as Record<string, unknown> | undefined)?._expiresAt
          if (typeof expiresAt === 'number' && now >= expiresAt) {
            Promise.all([ctx.runMutation(fns.delete, { key: entry.key }), ns.delete(entry.key).catch(() => {})]).catch(
              () => {},
            )
            continue
          }
          if (matchesFilter(entry.value, options?.filter ?? {})) {
            entries.push(entry)
          }
        }

        nextCursor = page.cursor
        if (target === undefined || entries.length >= target || nextCursor === undefined) {
          return {
            entries: target === undefined ? entries : entries.slice(0, target),
            ...(nextCursor === undefined ? {} : { cursor: nextCursor }),
          }
        }

        cursor = nextCursor
      } while (true)
    },

    vectorSearch(embedding: number[], options?: VectorSearchOptions): Promise<ScoredEntry[]> {
      return this.searchVectors!({
        dense: embedding,
        limit: options?.limit,
        threshold: options?.threshold,
        filter: options?.filter,
      })
    },

    async searchVectors(query: VectorSearchQuery): Promise<ScoredEntry[]> {
      if (!query.dense && !query.sparse) {
        throw new Error('searchVectors requires a dense or sparse query vector.')
      }

      const filter = upstashFilter(query.filter as never)
      const results = await ns.query({
        ...(query.dense ? { vector: query.dense } : {}),
        ...(query.sparse ? { sparseVector: query.sparse } : {}),
        ...(query.fusion ? { fusion: query.fusion } : {}),
        ...(filter ? { filter } : {}),
        topK: query.limit ?? 10,
        includeMetadata: true,
      })

      if (!results.length) {
        return []
      }

      const entries: ScoredEntry[] = []
      for (const result of results) {
        if (query.threshold !== undefined && result.score < query.threshold) {
          continue
        }

        const key = (result.metadata?._key as string) ?? String(result.id)
        const doc: RawMemoryDocument | null = await ctx.runQuery(fns.get, { key })
        if (!doc) {
          continue
        }

        const value = decodeStoredValue(doc)
        if (typeof value._expiresAt === 'number' && Date.now() >= value._expiresAt) {
          await Promise.all([ctx.runMutation(fns.delete, { key }), ns.delete(key).catch(() => {})])
          continue
        }
        if (query.filter && !matchesFilter(value, query.filter)) {
          continue
        }

        entries.push({
          key,
          value,
          score: result.score,
        })
      }

      return entries
    },

    supportsTtl(): boolean {
      return true
    },

    capabilities() {
      return {
        ttl: true,
        vectorSearch: { dense: true, sparse: true, hybrid: true },
        semanticCache: { isolatedVectorNamespace: Boolean(config.semanticCache?.isolatedVectorNamespace) },
      }
    },
  }
}

function decodeStoredValue(doc: RawMemoryDocument): JsonObject {
  if (doc.metadata && (doc.metadata as Record<string, unknown>)._cruxDoc) {
    return JSON.parse(doc.content) as JsonObject
  }
  return toStoreValue(doc)
}

function vectorMetadata(key: string, value: JsonObject): Record<string, unknown> {
  const metadata = { ...((value.metadata as Record<string, unknown>) ?? {}) }
  return {
    ...metadata,
    _key: key,
    ...(typeof value._cruxRecordType === 'string' ? { _cruxRecordType: value._cruxRecordType } : {}),
    ...(typeof value.namespace === 'string' ? { namespace: value.namespace } : {}),
    ...(typeof value.blockId === 'string' ? { blockId: value.blockId } : {}),
    ...(typeof value.sourceId === 'string' ? { sourceId: value.sourceId } : {}),
    ...(typeof value.chunkId === 'string' ? { chunkId: value.chunkId } : {}),
    ...(typeof value.parentId === 'string' ? { parentId: value.parentId } : {}),
    ...(typeof value.generationId === 'string' ? { generationId: value.generationId } : {}),
    ...(typeof value.active === 'boolean' ? { active: value.active } : {}),
  }
}
