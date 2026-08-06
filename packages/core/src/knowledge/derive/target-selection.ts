/**
 * Target/context chunk selection for assertion derivation.
 *
 * @module
 */

import { encodeKnowledgeRef } from '../refs'
import { stableHash } from '../../indexing/hash'
import type { CruxChunk } from '../../indexing/types'
import { orderDeriveChunks } from './prompt-bounds'

/** Canonical evidence identity key for a chunk. */
export function chunkKey(chunk: Pick<CruxChunk, 'sourceId' | 'chunkId'>): string {
  return encodeKnowledgeRef({ kind: 'chunk', sourceId: chunk.sourceId, chunkId: chunk.chunkId })
}

/** Deterministic selection of target chunks from a visible chunk set. */
export function selectTargetChunks(
  chunks: readonly CruxChunk[],
  selector: ((chunks: readonly CruxChunk[]) => readonly CruxChunk[]) | undefined,
): {
  readonly targetChunks: readonly CruxChunk[]
  readonly targetKeys: ReadonlySet<string>
  /** Stable role digest over the whole visible set; undefined without a selector. */
  readonly roleDigest: string | undefined
} {
  const ordered = orderDeriveChunks(chunks)
  if (!selector) {
    return {
      targetChunks: ordered,
      targetKeys: new Set(ordered.map(chunkKey)),
      roleDigest: undefined,
    }
  }
  const orderedKeys = new Set(ordered.map(chunkKey))
  const selectedKeys = new Set<string>()
  for (const chunk of selector(ordered)) {
    const key = chunkKey(chunk)
    if (!orderedKeys.has(key)) {
      throw new Error(
        `Derive target selector returned chunk "${chunk.sourceId}/${chunk.chunkId}" not in the source chunk set.`,
      )
    }
    selectedKeys.add(key)
  }
  return {
    targetChunks: ordered.filter((chunk) => selectedKeys.has(chunkKey(chunk))),
    targetKeys: new Set(selectedKeys),
    roleDigest: stableHash(ordered.map((chunk) => {
      const key = chunkKey(chunk)
      return `${key}:${selectedKeys.has(key) ? 'target' : 'context'}`
    })),
  }
}