/**
 * Data-store key derivation and paginated listing for corpus source records.
 *
 * Indexed chunk and parent record keys are owned by the internal indexed
 * knowledge read-model boundary.
 *
 * @module
 */

import type { RecordEntry, RecordStore } from '../storage'

/** Prefix for all corpus source records in a namespace. */
export function sourcePrefixKey(corpusId: string, namespace: string): string {
  return `corpus:${corpusId}:namespace:${namespace}:source:`
}

/** Key for a single corpus source record. */
export function sourceKey(corpusId: string, namespace: string, sourceId: string): string {
  return `${sourcePrefixKey(corpusId, namespace)}${encodeURIComponent(sourceId)}`
}

/** Read every store entry under a prefix, following pagination cursors. */
export async function listAll(store: RecordStore, prefix: string): Promise<RecordEntry[]> {
  const entries: RecordEntry[] = []
  let cursor: string | undefined

  while (true) {
    const page = await store.list(prefix, { cursor, limit: 100 })
    entries.push(...page.entries)
    if (!page.cursor) {
      return entries
    }
    cursor = page.cursor
  }
}
