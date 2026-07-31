/**
 * Component-backed document port for Convex storage.
 *
 * This module is the runtime edge between a structural Convex ctx and the
 * shared storage-document adapters in `store-doc`. It intentionally knows about
 * Convex component function refs, while serialization, TTL, and filtering stay
 * inside `store-doc`.
 *
 * @module
 */

import type { ConvexCruxStorageComponent } from './store-component'
import {
  type ComponentDocumentPort,
  type StoreDocPage,
  type StoreDocPageQuery,
  type StoreDocRecord,
} from './store-doc'

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
}

/** Alias for Convex ctx values accepted by the Convex storage adapters. */
export type ConvexContext = ConvexCtxPort

/** Configuration for the Convex component-backed storage adapters. */
export interface ConvexMemoryStoreConfig<TCtx extends ConvexCtxPort = ConvexCtxPort> {
  /** The Crux persistence component ref from `components.crux`. */
  component: ConvexCruxStorageComponent
  /** Convex action or mutation ctx with query/mutation runners. */
  ctx: TCtx
  /** Clock used for writes and TTL checks. Defaults to `Date.now`. */
  now?: () => number
}

/** Configuration for `convexComponentDocumentPort()`. */
export interface ConvexComponentDocumentPortConfig<TCtx extends ConvexCtxPort = ConvexCtxPort> {
  /** Convex action or mutation ctx with query/mutation runners. */
  readonly ctx: TCtx
  /** The Crux persistence component ref from `components.crux`. */
  readonly component: ConvexCruxStorageComponent
}

/**
 * Create the raw document I/O port for a Convex component.
 *
 * This is the local-substitutable boundary below the storage adapters. The
 * port forwards raw document reads/writes to the generated component refs.
 */
export function convexComponentDocumentPort<TCtx extends ConvexCtxPort = ConvexCtxPort>(
  config: ConvexComponentDocumentPortConfig<TCtx>,
): ComponentDocumentPort {
  const { component, ctx } = config
  const fns = component.memory

  return {
    get: (key) => ctx.runQuery<StoreDocRecord | null>(fns.get, { key }),
    list: (query) => ctx.runQuery<StoreDocPage<StoreDocRecord>>(fns.list, storeDocPageArgs(query)),
    async put(doc) {
      await ctx.runMutation(fns.set, doc)
    },
    insert: (doc) => ctx.runMutation<boolean>(fns.insert, doc),
    async delete(key) {
      await ctx.runMutation(fns.remove, { key })
    },
    compareAndSet(key, expectedVersion, doc) {
      if (!fns.compareAndSet) {
        throw new Error(
          'The installed Crux Convex component does not expose memory.compareAndSet. Redeploy the current @use-crux/convex component.',
        )
      }
      return ctx.runMutation<boolean>(fns.compareAndSet, {
        key,
        expectedVersion,
        doc,
      })
    },
  }
}

function storeDocPageArgs(query: StoreDocPageQuery): Record<string, unknown> {
  return {
    prefix: query.prefix,
    ...(query.limit === undefined ? {} : { limit: query.limit }),
    ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
  }
}
