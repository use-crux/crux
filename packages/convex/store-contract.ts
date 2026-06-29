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

import type { CruxStore } from '@use-crux/core/store'
import type { CruxTransport } from '@use-crux/react'
import { createConvexTransport, type UseQueryFn } from './react'
import { convexComponentDocumentPort, type ConvexCtxPort } from './store'
import type {
  ConvexCruxStoreComponent,
  ConvexCruxStoreTransportComponent,
  ConvexStoreDocumentComponent,
} from './store-component'
import { isConvexStoreDocumentComponent } from './store-document-component'
import {
  STORE_DOC_COMPONENT_SPEC,
  createStoreDocCodec,
  createStoreDocStore,
  type StoreDocCodec,
  type StoreDocCodecOptions,
  type StoreDocRecord,
} from './store-doc'

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
export interface DefineConvexStoreContractOptions<TCtx extends ConvexCtxPort = ConvexCtxPort> {
  /**
   * The Crux persistence component.
   *
   * Pass generated Convex refs from `components.crux` in apps, or a normalized
   * `ConvexStoreDocumentComponent` in tests and alternate runtimes.
   */
  readonly component: ConvexCruxStoreComponent | ConvexStoreDocumentComponent<TCtx>
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
  readonly api?: ConvexCruxStoreTransportComponent
}

/**
 * Contract object for the Convex Crux store document format.
 *
 * The codec is exposed for focused tests and migration tools. `store()` creates
 * the server-side `CruxStore`; `transport()` creates the React read transport
 * with matching document decoding semantics.
 */
export interface ConvexStoreContract<TCtx extends ConvexCtxPort = ConvexCtxPort> {
  /** Normalized or generated component used by this contract. */
  readonly component: ConvexCruxStoreComponent | ConvexStoreDocumentComponent<TCtx>
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
 * import { defineConvexStoreContract } from '@use-crux/convex'
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
  options: DefineConvexStoreContractOptions<TCtx>,
): ConvexStoreContract<TCtx> {
  const { component, now, semanticCache, vectorIndexName = STORE_DOC_COMPONENT_SPEC.defaultVectorIndexName } = options
  const codec = createStoreDocCodec({ now })
  const refs = isConvexStoreDocumentComponent(component) ? component.refs : component

  return {
    component,
    codec,
    store(ctx) {
      return createStoreDocStore<StoreDocRecord>({
        io: isConvexStoreDocumentComponent(component)
          ? component.io(ctx, { vectorIndexName })
          : convexComponentDocumentPort({ component, ctx, vectorIndexName }),
        now,
        semanticCache,
        denseVectorSearch: true,
      })
    },
    transport(args) {
      if (isConvexStoreDocumentComponent(component)) {
        return component.reads({
          useQuery: args.useQuery,
          api: args.api ?? refs,
          now,
        })
      }
      return createConvexTransport({
        api: args.api ?? refs,
        now,
        useQuery: args.useQuery,
      })
    },
  }
}
