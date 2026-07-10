/**
 * Structural Convex component API types used by the Crux storage adapters.
 *
 * Generated Convex component references are deeply typed. Crux only needs a
 * small structural surface here so tests, apps, and generated component refs
 * can all satisfy the adapter boundary without pulling generated types through every
 * adapter boundary.
 *
 * @module
 */

import type { CruxTransport } from '@use-crux/react'
import type { UseQueryFn } from './react'
import type { ConvexCtxPort } from './store'
import type { ComponentDocumentPort, StoreDocCodecOptions, StoreDocComponentTable, StoreDocRecord } from './store-doc'

/** Convex memory function references required by the server-side Crux record store. */
export interface ConvexCruxStorageMemoryComponent {
  /** Query reference for reading one memory document by key. */
  readonly get: unknown
  /** Query reference for listing memory documents by key prefix. */
  readonly list: unknown
  /** Mutation reference for inserting or replacing one memory document. */
  readonly set: unknown
  /** Mutation reference for inserting one memory document only when absent. */
  readonly insert: unknown
  /** Mutation reference for deleting one memory document by key. */
  readonly remove: unknown
}

/** Convex component reference required by the Crux storage document contract. */
export interface ConvexCruxStorageComponent {
  /** Memory module exposed by the Crux Convex component. */
  readonly memory: ConvexCruxStorageMemoryComponent
}

/** Convex component reference required by the React read transport. */
export interface ConvexCruxStorageTransportComponent {
  /** Memory queries used by reactive Crux reads. */
  readonly memory: Pick<ConvexCruxStorageMemoryComponent, 'get' | 'list'>
}

/** Options passed when a normalized component creates server document I/O. */
export interface ConvexStoreDocumentComponentIoOptions {
  /** Vector index name used for dense vector search. */
  readonly vectorIndexName: string
}

/** Options passed when a normalized component creates React document reads. */
export interface ConvexStoreDocumentComponentReadOptions {
  /**
   * Convex `useQuery` hook implementation.
   *
   * Tests can pass a local substitute with the same call shape.
   */
  readonly useQuery: UseQueryFn
  /** Optional transport API override for generated-client environments. */
  readonly api?: ConvexCruxStorageTransportComponent
  /** Clock used for TTL checks. Defaults to `Date.now`. */
  readonly now?: StoreDocCodecOptions['now']
}

/**
 * Normalized Convex storage document component.
 *
 * A component exposes generated refs for app ergonomics, a document I/O port
 * for server storage adapters, and React read hooks that decode the same raw documents.
 */
export interface ConvexStoreDocumentComponent<TCtx extends ConvexCtxPort = ConvexCtxPort> {
  /** Generated Convex component refs used by app-facing server and client APIs. */
  readonly refs: ConvexCruxStorageComponent
  /** Backing component table name. */
  readonly table: StoreDocComponentTable
  /** Create raw document I/O for a server-side Convex ctx. */
  io(ctx: TCtx, options: ConvexStoreDocumentComponentIoOptions): ComponentDocumentPort<StoreDocRecord>
  /** Create React transport reads for the component. */
  reads(args: ConvexStoreDocumentComponentReadOptions): Pick<CruxTransport, 'useDocument' | 'useDocumentList'>
}
