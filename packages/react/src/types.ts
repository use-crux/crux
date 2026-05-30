/**
 * Transport interface for reactive document access.
 *
 * Each method IS a React hook. Transports implement these using
 * their native reactive primitive (Convex useQuery, useSyncExternalStore, etc.).
 *
 * @module
 */

import type { JsonObject, StoreEntry, ListOptions } from '@crux/core/store'

/**
 * Transport interface for reactive CruxStore access.
 *
 * Each method IS a React hook — transports implement these using their native
 * reactive primitive. Convex uses `useQuery()`, SSE uses `useSyncExternalStore`,
 * polling uses `useSyncExternalStore` with a timer.
 *
 * Return semantics:
 * - `undefined` = loading (no data yet) or skipped (undefined key/prefix)
 * - `null` = loaded, document not found (`useDocument` only)
 * - `JsonObject` / `StoreEntry[]` = loaded with data
 */
export interface CruxTransport {
  /**
   * React hook: subscribe to a single document by key.
   * Pass `undefined` to skip the query (returns `undefined`).
   */
  useDocument(key: string | undefined): JsonObject | null | undefined

  /**
   * React hook: subscribe to a list of documents by key prefix.
   * Pass `undefined` as prefix to skip the query (returns `undefined`).
   */
  useDocumentList(prefix: string | undefined, options?: ListOptions): StoreEntry[] | undefined
}
