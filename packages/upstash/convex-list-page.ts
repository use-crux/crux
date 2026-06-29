/**
 * Convex component page normalization for the Upstash-backed memory store.
 *
 * The beta adapter reads page-shaped component results, while still accepting
 * the old array-shaped fake result so older local tests fail softly.
 *
 * @module
 */

import type { RawMemoryDocument } from '@use-crux/core/memory'

export interface ConvexMemoryListPage {
  docs: RawMemoryDocument[]
  cursor?: string
}

export function normalizeListPage(result: unknown): ConvexMemoryListPage {
  if (Array.isArray(result)) {
    return { docs: result as RawMemoryDocument[] }
  }
  if (result && typeof result === 'object' && Array.isArray((result as { docs?: unknown }).docs)) {
    const page = result as { docs: RawMemoryDocument[]; cursor?: unknown }
    return {
      docs: page.docs,
      ...(typeof page.cursor === 'string' ? { cursor: page.cursor } : {}),
    }
  }
  return { docs: [] }
}
