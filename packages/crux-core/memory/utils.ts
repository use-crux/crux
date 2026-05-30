/**
 * Shared storage helpers for memory store adapters.
 *
 * @module
 */

import type { JsonObject } from '../store/types'

/**
 * Raw document shape as stored in databases.
 * Timestamps are numbers (milliseconds since epoch), metadata may be absent.
 */
export interface RawMemoryDocument {
  key: string
  content: string
  metadata?: Record<string, unknown>
  embedding?: number[]
  createdAt: number
  updatedAt: number
}

/**
 * Convert a raw database document to a `JsonObject` suitable for `CruxStore.set()`.
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
 * import { toStoreValue } from '@crux/core/memory'
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

/**
 * @deprecated Use `toStoreValue` instead. Kept for backward compatibility during migration.
 */
export const toMemoryEntry = toStoreValue
