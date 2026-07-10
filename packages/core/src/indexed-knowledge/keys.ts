/**
 * Key derivation for indexed knowledge records.
 *
 * Keep chunk and parent key formatting here so indexing, retrieval, and parent
 * expansion share one persisted key contract.
 *
 * @module
 */

import type { RecordEntry, RecordStore } from '../storage'

/** Prefix for all records in an indexer namespace. */
export function indexedNamespacePrefix(indexerId: string, namespace: string): string {
  return `indexer:${indexerId}:namespace:${namespace}:`
}

/** Prefix for every indexed record that belongs to one source. */
export function indexedSourcePrefix(indexerId: string, namespace: string, sourceId: string): string {
  return `${indexedNamespacePrefix(indexerId, namespace)}source:${sourceId}:`
}

/** Key for a persisted child chunk record. */
export function indexedChunkKey(indexerId: string, namespace: string, sourceId: string, chunkId: string): string {
  return `${indexedSourcePrefix(indexerId, namespace, sourceId)}chunk:${chunkId}`
}

/** Key for a persisted parent chunk record. */
export function indexedParentKey(indexerId: string, namespace: string, sourceId: string, parentId: string): string {
  return `${indexedSourcePrefix(indexerId, namespace, sourceId)}parent:${parentId}`
}

/** Read every entry under a prefix, following store cursors. */
export async function listIndexedEntries(store: RecordStore, prefix: string): Promise<RecordEntry[]> {
  const entries: RecordEntry[] = []
  let cursor: string | undefined

  while (true) {
    const page = await store.list(prefix, { cursor, limit: 100 })
    entries.push(...page.entries)
    if (!page.cursor) return entries
    cursor = page.cursor
  }
}
