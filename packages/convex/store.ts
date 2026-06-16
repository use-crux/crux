/**
 * Component-backed CruxStore adapter for Convex.
 *
 * This module is the runtime edge between a structural Convex ctx and the
 * shared store-document policy in `store-doc`. It intentionally knows about
 * Convex component function refs, while serialization, TTL, filtering, and
 * vector result shaping stay inside `store-doc`.
 *
 * @module
 */

import type { CruxStore } from '@crux/core/store'
import type { ComponentApi } from './src/component/_generated/component'
import { createStoreDocStore, type StoreDocRecord } from './store-doc'

/**
 * Minimal Convex ctx port used by the Crux Convex runtime profile.
 *
 * The port is structural so tests, migrations, and alternate Convex runtimes
 * can provide compatible fakes without importing generated Convex server
 * types. Generated component refs still provide the function-level typing at
 * app call sites.
 */
export interface ConvexCtxPort {
  /** Execute a Convex query function reference. */
  runQuery<TResult = unknown>(ref: unknown, args: Record<string, unknown>): Promise<TResult>
  /** Execute a Convex mutation function reference. */
  runMutation<TResult = unknown>(ref: unknown, args: Record<string, unknown>): Promise<TResult>
  /** Execute a Convex action function reference when the current ctx supports it. */
  runAction?<TResult = unknown>(ref: unknown, args: Record<string, unknown>): Promise<TResult>
  /** Optional dense vector-search port exposed by Convex action contexts. */
  vectorSearch?(
    table: string,
    index: string,
    opts: { vector: readonly number[]; limit?: number },
  ): Promise<readonly StoreDocRecord[]>
}

/**
 * Backwards-compatible name for Convex ctx values accepted by
 * `cruxConvexStore()`.
 */
export type ConvexContext = ConvexCtxPort

/** Configuration for the Convex component-backed CruxStore. */
export interface ConvexMemoryStoreConfig<TCtx extends ConvexCtxPort = ConvexCtxPort> {
  /** The Crux persistence component ref from `components.crux`. */
  component: ComponentApi
  /** Convex action or mutation ctx with query/mutation runners. */
  ctx: TCtx
  /**
   * Vector index name for dense vector search via `ctx.vectorSearch`.
   *
   * @default 'by_embedding'
   */
  vectorIndexName?: string
  /**
   * Declare this store/index is dedicated to semantic cache entries.
   *
   * Use this only when the backing vector index is not shared with memory or
   * retrieval vectors, because semantic-cache lookup must not compete with
   * unrelated vectors before filtering.
   */
  semanticCache?: {
    isolatedVectorNamespace?: boolean
  }
}

/**
 * Create a `CruxStore` backed by the Crux Convex component.
 *
 * The returned store is a normal Crux store. It supports TTL, top-level list
 * filters, component-backed CRUD, and dense vector search when the ctx exposes
 * `vectorSearch()`.
 *
 * @param config - Component ref, Convex ctx, and optional vector/cache options.
 * @returns A component-backed Crux store.
 *
 * @example
 * ```ts
 * import { cruxConvexStore } from '@crux/convex'
 * import { components } from './_generated/api'
 *
 * const store = cruxConvexStore({
 *   component: components.crux,
 *   ctx,
 * })
 * ```
 */
export function cruxConvexStore<TCtx extends ConvexCtxPort = ConvexCtxPort>(
  config: ConvexMemoryStoreConfig<TCtx>,
): CruxStore {
  const { component, ctx, vectorIndexName = 'by_embedding' } = config
  const fns = component.memory
  const vectorSearch = ctx.vectorSearch

  return createStoreDocStore({
    semanticCache: config.semanticCache,
    denseVectorSearch: true,
    io: {
      get: (key) => ctx.runQuery<StoreDocRecord | null>(fns.get, { key }),
      list: (query) =>
        ctx.runQuery<readonly StoreDocRecord[]>(fns.list, {
          prefix: query.prefix,
          limit: query.limit,
          cursor: query.cursor,
          filter: query.filter,
        }),
      async put(doc) {
        await ctx.runMutation(fns.set, doc)
      },
      async delete(key) {
        await ctx.runMutation(fns.remove, { key })
      },
      searchDense: vectorSearch
        ? ({ vector, limit }) => vectorSearch('memories', vectorIndexName, { vector, limit })
        : undefined,
    },
  })
}
