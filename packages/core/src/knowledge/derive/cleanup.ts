/**
 * Source-scoped derive claim cleanup.
 *
 * @module
 */

import { indexedNamespacePrefix, listIndexedEntries } from '../../indexed-knowledge/keys'
import type { RecordStore } from '../../storage'
import { knowledgeClaimsKey } from '../keys'

/** Delete cached derive claim records for one removed source. */
export async function deleteKnowledgeClaimsForSource(input: {
  readonly records: RecordStore
  readonly indexerId: string
  readonly namespace: string
  readonly sourceId: string
  readonly stageIds?: readonly string[]
}): Promise<number> {
  const prefixes = input.stageIds?.length
    ? input.stageIds.map((stageId) => knowledgeClaimsKey(input.indexerId, input.namespace, stageId, input.sourceId, ''))
    : [`${indexedNamespacePrefix(input.indexerId, input.namespace)}claims:`]
  let deleted = 0
  for (const prefix of prefixes) {
    const entries = await listIndexedEntries(input.records, prefix)
    const selected = input.stageIds?.length
      ? entries
      : entries.filter((entry) => entry.key.includes(`:source:${input.sourceId}:`))
    for (const entry of selected) {
      await input.records.delete(entry.key)
      deleted += 1
    }
  }
  return deleted
}
