/**
 * `@use-crux/upstash` - Upstash Vector store adapter for Crux.
 *
 * Hybrid storage: text/metadata persisted in Convex (reliable, transactional),
 * vectors stored in Upstash Vector (fast similarity search).
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
import type { VectorHit, VectorRecord, VectorStore } from '@use-crux/core/storage'
import { toStoreValue } from '@use-crux/core/memory'
import type { RawMemoryDocument } from '@use-crux/core/memory'

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
 * Structural shape of an `@upstash/vector` index — both the SDK's `Index` and
 * `Index.namespace(...)` satisfy this. The SDK's input/output types are a
 * complex discriminated union (alt forms with `data:` vs `vector:` vs
 * `sparseVector:`), so we accept `unknown` for the params and narrow at
 * call sites with our own `UpstashUpsertData` / `UpstashQueryData` shapes.
 */
interface UpstashIndex {
  namespace(name: string): UpstashNamespace
  upsert(data: unknown): Promise<unknown>
  query(data: unknown): Promise<UpstashQueryResult[]>
  delete(ids: unknown): Promise<unknown>
}

interface UpstashNamespace {
  upsert(data: unknown): Promise<unknown>
  query(data: unknown): Promise<UpstashQueryResult[]>
  delete(ids: unknown): Promise<unknown>
}

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

export interface UpstashVectorStoreConfig {
  /** Upstash Vector index instance. */
  index: UpstashIndex
  /** Namespace for this vector store. */
  namespace: string
}

export function upstashVectorStore(config: UpstashVectorStoreConfig): VectorStore {
  const ns = config.index.namespace(config.namespace)

  return {
    _tag: 'VectorStore',
    async upsert(records: readonly VectorRecord[]): Promise<void> {
      if (records.length === 0) return
      await ns.upsert(records.map((record) => ({
        id: record.key,
        ...(record.dense ? { vector: record.dense } : {}),
        ...(record.sparse ? { sparseVector: record.sparse } : {}),
        ...(record.metadata ? { metadata: { ...record.metadata, _key: record.key } } : { metadata: { _key: record.key } }),
      } satisfies UpstashUpsertData)))
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

    async delete(key: string): Promise<void> {
      await Promise.all([
        ctx.runMutation(fns.delete, { key }),
        ns.delete(key).catch(() => {}),
      ])
    },

    async list(prefix: string, options?: ListOptions): Promise<ListResult> {
      const docs: RawMemoryDocument[] = await ctx.runQuery(fns.list, {
        prefix,
        limit: options?.limit,
        cursor: options?.cursor,
        filter: options?.filter,
      })

      const now = Date.now()
      const entries: StoreEntry[] = (docs ?? [])
        .map((doc) => ({
          key: doc.key,
          value: decodeStoredValue(doc),
        }))
        .filter((entry) => {
          const expiresAt =
            typeof entry.value._expiresAt === 'number'
              ? entry.value._expiresAt
              : (entry.value.metadata as Record<string, unknown> | undefined)?._expiresAt
          if (typeof expiresAt === 'number' && now >= expiresAt) {
            Promise.all([ctx.runMutation(fns.delete, { key: entry.key }), ns.delete(entry.key).catch(() => {})]).catch(
              () => {},
            )
            return false
          }
          return true
        })

      return { entries }
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

      const filter = upstashFilter(query.filter)
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
        if (query.filter && !matchesTopLevelFilter(value, query.filter)) {
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

function matchesTopLevelFilter(value: JsonObject, filter: Record<string, unknown>): boolean {
  for (const [key, expected] of Object.entries(filter)) {
    const actual = value[key]
    if (expected === null) {
      if (actual !== null && actual !== undefined) {
        return false
      }
      continue
    }
    if (actual !== expected) {
      return false
    }
  }
  return true
}

function vectorMetadata(key: string, value: JsonObject): Record<string, unknown> {
  const metadata = { ...((value.metadata as Record<string, unknown>) ?? {}) }
  return {
    ...metadata,
    _key: key,
    ...(typeof value._cruxRecordType === 'string' ? { _cruxRecordType: value._cruxRecordType } : {}),
    ...(typeof value.namespace === 'string' ? { namespace: value.namespace } : {}),
    ...(typeof value.sourceId === 'string' ? { sourceId: value.sourceId } : {}),
    ...(typeof value.chunkId === 'string' ? { chunkId: value.chunkId } : {}),
    ...(typeof value.parentId === 'string' ? { parentId: value.parentId } : {}),
    ...(typeof value.generationId === 'string' ? { generationId: value.generationId } : {}),
    ...(typeof value.active === 'boolean' ? { active: value.active } : {}),
  }
}

function upstashFilter(filter: Record<string, unknown> | undefined): string | undefined {
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
