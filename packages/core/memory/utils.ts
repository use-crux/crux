/**
 * Shared storage helpers for memory record adapters.
 *
 * @module
 */

import type { JsonObject } from '../storage'

/**
 * Raw document shape as stored in databases.
 * Timestamps are numbers (milliseconds since epoch), metadata may be absent.
 */
export interface RawMemoryDocument {
  key: string
  content: string
  metadata?: JsonObject
  embedding?: number[]
  createdAt: number
  updatedAt: number
}

/**
 * Convert a raw database document to a `JsonObject` suitable for `RecordStore.put()`.
 *
 * Handles the common transformations needed by store adapters:
 * - Missing metadata → empty object `{}`
 * - Passes through timestamps as numbers (no Date conversion)
 *
 * @param doc - Raw document from the database
 * @returns A `JsonObject` ready for store consumption
 *
 * @example
 * ```ts
 * import { toStoreValue } from '@use-crux/core/memory'
 *
 * const values = rawDocs.map(toStoreValue)
 * ```
 */
export function toStoreValue(doc: RawMemoryDocument): JsonObject {
  return {
    content: doc.content,
    metadata: doc.metadata ?? {},
    ...(doc.embedding ? { embedding: doc.embedding } : {}),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  }
}
