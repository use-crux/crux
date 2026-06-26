/**
 * Shared Convex store document contract.
 *
 * This module is the public coordination point for the Convex store document
 * format. It keeps the codec, server-side `CruxStore`, and React transport
 * discoverable from one typed object while delegating behavior to the focused
 * modules that already own it.
 *
 * @module
 */

import type { CruxStore } from '@crux/core/store'
import type { CruxTransport } from '@crux/react'
import { createConvexTransport, type UseQueryFn } from './react'
import { cruxConvexStore, type ConvexCtxPort } from './store'
import type { ConvexCruxStoreComponent } from './store-component'
import { createStoreDocCodec, type StoreDocCodec, type StoreDocCodecOptions } from './store-doc'

/** Options for semantic-cache capability metadata on Convex stores. */
export interface ConvexStoreSemanticCacheOptions {
  /**
   * Whether the backing vector namespace is dedicated to semantic-cache rows.
   *
   * Set this only when the Convex vector index does not mix cache vectors with
   * ordinary memory or retrieval vectors.
   */
  readonly isolatedVectorNamespace?: boolean
}

/** Configuration for `defineConvexStoreContract()`. */
export interface DefineConvexStoreContractOptions {
  /** The Crux persistence component ref from `components.crux`. */
  readonly component: ConvexCruxStoreComponent
  /**
   * Vector index name for dense vector search via `ctx.vectorSearch`.
   *
   * @default 'by_embedding'
   */
  readonly vectorIndexName?: string
  /** Semantic-cache capability metadata for the server store. */
  readonly semanticCache?: ConvexStoreSemanticCacheOptions
  /** Clock used for codec writes and TTL checks. Defaults to `Date.now`. */
  readonly now?: StoreDocCodecOptions['now']
}

/** Arguments for creating the React transport from a Convex store contract. */
export interface ConvexStoreContractTransportOptions {
  /**
   * Convex `useQuery` hook implementation.
   *
   * Pass `useQuery` from `convex/react` in application code, or a compatible
   * fake in tests.
   */
  readonly useQuery: UseQueryFn
  /**
   * Optional component API override for apps whose client API object differs
   * from the server component reference used by `store()`.
   *
   * Defaults to the component passed to `defineConvexStoreContract()`.
   */
  readonly api?: ConvexCruxStoreComponent
}

/**
 * Contract object for the Convex Crux store document format.
 *
 * The codec is exposed for focused tests and migration tools. `store()` creates
 * the server-side `CruxStore`; `transport()` creates the React read transport
 * with matching document decoding semantics.
 */
export interface ConvexStoreContract<TCtx extends ConvexCtxPort = ConvexCtxPort> {
  /** Shared store document codec used by this contract. */
  readonly codec: StoreDocCodec
  /** Create a server-side Crux store for a Convex action or mutation context. */
  store(ctx: TCtx): CruxStore
  /** Create a React transport for reading Crux documents through Convex queries. */
  transport(args: ConvexStoreContractTransportOptions): CruxTransport
}

/**
 * Define the Convex store document contract for one Crux component.
 *
 * Use this when an app wants one stable object that creates both the server
 * `CruxStore` and React transport for the same document format.
 *
 * @param options - Component reference plus optional vector, cache, and clock policy.
 * @returns A typed Convex store contract.
 *
 * @example
 * ```ts
 * import { defineConvexStoreContract } from '@crux/convex'
 * import { components } from './_generated/api'
 *
 * const cruxStore = defineConvexStoreContract({
 *   component: components.crux,
 *   vectorIndexName: 'by_embedding',
 * })
 *
 * const store = cruxStore.store(ctx)
 * const transport = cruxStore.transport({ useQuery })
 * ```
 */
export function defineConvexStoreContract<TCtx extends ConvexCtxPort = ConvexCtxPort>(
  options: DefineConvexStoreContractOptions,
): ConvexStoreContract<TCtx> {
  const { component, now, semanticCache, vectorIndexName } = options
  const codec = createStoreDocCodec({ now })

  return {
    codec,
    store(ctx) {
      return cruxConvexStore({
        component,
        ctx,
        ...(now === undefined ? {} : { now }),
        ...(vectorIndexName === undefined ? {} : { vectorIndexName }),
        ...(semanticCache === undefined ? {} : { semanticCache }),
      })
    },
    transport(args) {
      return createConvexTransport({
        api: args.api ?? component,
        useQuery: args.useQuery,
      })
    },
  }
}
