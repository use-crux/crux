/**
 * Data-store key derivation and paginated listing for indexing.
 *
 * Indexer records are keyed by indexer id + namespace + source + chunk/parent;
 * corpus source records by corpus id + namespace + source.
 *
 * @module
 */

import type { DataStore, StoreEntry } from '../store/types'

/** Prefix for all records in an indexer namespace. */
export function namespacePrefix(indexerId: string, namespace: string): string {
  return `indexer:${indexerId}:namespace:${namespace}:`
}

/** Prefix for all records of a single source. */
export function sourcePrefix(indexerId: string, namespace: string, sourceId: string): string {
  return `${namespacePrefix(indexerId, namespace)}source:${sourceId}:`
}

/** Key for a single chunk record. */
export function chunkKey(indexerId: string, namespace: string, sourceId: string, chunkId: string): string {
  return `${sourcePrefix(indexerId, namespace, sourceId)}chunk:${chunkId}`
}

/** Key for a single parent-chunk record. */
export function parentKey(indexerId: string, namespace: string, sourceId: string, parentId: string): string {
  return `${sourcePrefix(indexerId, namespace, sourceId)}parent:${parentId}`
}

/** Prefix for all corpus source records in a namespace. */
export function sourcePrefixKey(corpusId: string, namespace: string): string {
  return `corpus:${corpusId}:namespace:${namespace}:source:`
}

/** Key for a single corpus source record. */
export function sourceKey(corpusId: string, namespace: string, sourceId: string): string {
  return `${sourcePrefixKey(corpusId, namespace)}${encodeURIComponent(sourceId)}`
}

/** Read every store entry under a prefix, following pagination cursors. */
export async function listAll(store: DataStore, prefix: string): Promise<StoreEntry[]> {
  const entries: StoreEntry[] = []
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
