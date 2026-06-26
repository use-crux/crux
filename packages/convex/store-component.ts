/**
 * Structural Convex component API types used by the Crux store contract.
 *
 * Generated Convex component references are deeply typed. Crux only needs a
 * small structural surface here so tests, apps, and generated component refs
 * can all satisfy the contract without pulling generated types through every
 * adapter boundary.
 *
 * @module
 */

/** Convex memory function references required by the server-side Crux store. */
export interface ConvexCruxStoreMemoryComponent {
  /** Query reference for reading one memory document by key. */
  readonly get: unknown
  /** Query reference for listing memory documents by key prefix. */
  readonly list: unknown
  /** Mutation reference for inserting or replacing one memory document. */
  readonly set: unknown
  /** Mutation reference for deleting one memory document by key. */
  readonly remove: unknown
}

/** Convex component reference required by the Crux store document contract. */
export interface ConvexCruxStoreComponent {
  /** Memory module exposed by the Crux Convex component. */
  readonly memory: ConvexCruxStoreMemoryComponent
}

/** Convex component reference required by the React read transport. */
export interface ConvexCruxStoreTransportComponent {
  /** Memory queries used by reactive Crux reads. */
  readonly memory: Pick<ConvexCruxStoreMemoryComponent, 'get' | 'list'>
}
