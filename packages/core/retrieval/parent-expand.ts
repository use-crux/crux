/**
 * Parent expansion retrieval stage.
 *
 * Hydrates child hits with parent chunk content through the indexed knowledge
 * read-model boundary so key derivation and parent record validation stay in
 * one internal contract.
 *
 * @module
 */

import { createIndexedKnowledgeStore } from '../indexed-knowledge'
import type { RecordStore } from '../storage'
import { retrievalStage } from './stage'
import type { HitRetrievalStage, RetrieverHit } from './types'

/** Hydrate each hit with its parent record's content/metadata. */
export function parentExpand(config: {
  records: RecordStore
  indexerId?: string
  maxParentChars?: number
  missing?: 'ignore' | 'warn' | 'error'
}): HitRetrievalStage {
  const missing = config.missing ?? 'warn'
  return retrievalStage({
    name: 'parent-expand',
    phase: 'hits',
    kind: 'parent-expand',
    async run({ hits, retrieverId }) {
      const warnings: string[] = []
      const expanded: RetrieverHit[] = []
      for (const hit of hits) {
        if (!hit.parent?.key && !hit.parent?.parentId) {
          expanded.push(hit)
          continue
        }

        const records = createIndexedKnowledgeStore({
          indexerId: config.indexerId ?? retrieverId,
          namespace: hit.namespace,
          records: config.records,
        })
        const parentRecord = await records.getParent({
          sourceId: hit.sourceId,
          parentId: hit.parent?.parentId,
          key: hit.parent?.key,
        })
        if (!parentRecord) {
          const parentRef = hit.parent?.key ?? hit.parent?.parentId
          const warning = `parentExpand could not find parent record "${parentRef}" for ${hit.sourceId}/${hit.chunkId}.`
          if (missing === 'error') throw new Error(warning)
          if (missing === 'warn') warnings.push(warning)
          expanded.push(hit)
          continue
        }

        const content =
          config.maxParentChars !== undefined ? parentRecord.content.slice(0, config.maxParentChars) : parentRecord.content
        expanded.push({
          ...hit,
          parent: {
            ...(hit.parent ?? {}),
            parentId: parentRecord.parentId,
            content,
            metadata: parentRecord.metadata,
          },
        })
      }
      return { hits: expanded, warnings }
    },
  })
}
