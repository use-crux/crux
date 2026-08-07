/**
 * Input normalization for deterministic knowledge community clustering.
 *
 * @module
 */

import { encodeKnowledgeRef } from '../refs'
import type {
  CommunityChunkInput,
  CommunityEntityEdgeInput,
  CommunityEntityInput,
  CommunityGraphInput,
  CommunityMentionWeightInput,
} from './types'

/** Normalize ordering, dedupe edges/mentions, and derive residual chunks. */
export function normalizeCommunityGraphInput(input: CommunityGraphInput): CommunityGraphInput {
  const entities = dedupeEntities(input.entities)
  const entityIds = new Set(entities.map((entity) => entity.entityId))
  const chunks = dedupeChunks(input.chunks)
  const chunkKeys = new Set(chunks.map((chunk) => encodeKnowledgeRef(chunk.ref)))
  const mentionWeights = coalesceMentions(input.mentionWeights, entityIds, chunkKeys)
  const mentionedChunks = new Set(mentionWeights.map((mention) => encodeKnowledgeRef(mention.chunkRef)))

  return {
    namespace: input.namespace,
    entities,
    chunks,
    mentionWeights,
    residualChunks: chunks.filter((chunk) => !mentionedChunks.has(encodeKnowledgeRef(chunk.ref))),
    edges: coalesceEdges(input.edges, entityIds),
    assertions: [...(input.assertions ?? [])].map((assertion) => ({
      ...assertion,
      evidence: [...new Map(assertion.evidence.map((support) => [encodeKnowledgeRef(support.chunkRef), support])).values()]
        .sort((left, right) => encodeKnowledgeRef(left.chunkRef).localeCompare(encodeKnowledgeRef(right.chunkRef))),
    })).sort((left, right) => left.assertionId.localeCompare(right.assertionId)),
    assertionRelations: [...(input.assertionRelations ?? [])].sort((left, right) => left.relationId.localeCompare(right.relationId)),
  }
}

function dedupeEntities(entities: readonly CommunityEntityInput[]): readonly CommunityEntityInput[] {
  const byId = new Map<string, CommunityEntityInput>()
  for (const entity of [...entities].sort((left, right) => left.entityId.localeCompare(right.entityId))) {
    if (!byId.has(entity.entityId)) byId.set(entity.entityId, entity)
  }
  return [...byId.values()]
}

function dedupeChunks(chunks: readonly CommunityChunkInput[]): readonly CommunityChunkInput[] {
  const byRef = new Map<string, CommunityChunkInput>()
  for (const chunk of [...chunks].sort(compareChunks)) {
    const key = encodeKnowledgeRef(chunk.ref)
    if (!byRef.has(key)) byRef.set(key, chunk)
  }
  return [...byRef.values()]
}

function coalesceMentions(
  mentions: readonly CommunityMentionWeightInput[],
  entityIds: ReadonlySet<string>,
  chunkKeys: ReadonlySet<string>,
): readonly CommunityMentionWeightInput[] {
  const totals = new Map<string, CommunityMentionWeightInput>()
  for (const mention of mentions) {
    const chunkKey = encodeKnowledgeRef(mention.chunkRef)
    if (!entityIds.has(mention.entityId) || !chunkKeys.has(chunkKey) || mention.weight <= 0) continue
    const key = `${chunkKey}\0${mention.entityId}`
    const existing = totals.get(key)
    totals.set(key, {
      chunkRef: mention.chunkRef,
      entityId: mention.entityId,
      weight: (existing?.weight ?? 0) + mention.weight,
    })
  }
  return [...totals.values()].sort(compareMentions)
}

function coalesceEdges(
  edges: readonly CommunityEntityEdgeInput[],
  entityIds: ReadonlySet<string>,
): readonly CommunityEntityEdgeInput[] {
  const totals = new Map<string, number>()
  for (const edge of edges.map(normalizeEdge)) {
    if (
      edge.leftEntityId === edge.rightEntityId ||
      !entityIds.has(edge.leftEntityId) ||
      !entityIds.has(edge.rightEntityId) ||
      edge.weight <= 0 ||
      !Number.isFinite(edge.weight)
    ) continue
    const key = `${edge.leftEntityId}\0${edge.rightEntityId}`
    totals.set(key, (totals.get(key) ?? 0) + edge.weight)
  }
  return [...totals.entries()].flatMap(([key, weight]) => {
    const [leftEntityId, rightEntityId] = key.split('\0')
    return leftEntityId && rightEntityId ? [{ leftEntityId, rightEntityId, weight }] : []
  }).sort(compareEdges)
}

function normalizeEdge(edge: CommunityEntityEdgeInput): CommunityEntityEdgeInput {
  return edge.leftEntityId <= edge.rightEntityId
    ? edge
    : { leftEntityId: edge.rightEntityId, rightEntityId: edge.leftEntityId, weight: edge.weight }
}

function compareEdges(left: CommunityEntityEdgeInput, right: CommunityEntityEdgeInput): number {
  return left.leftEntityId.localeCompare(right.leftEntityId) || left.rightEntityId.localeCompare(right.rightEntityId)
}

function compareMentions(left: CommunityMentionWeightInput, right: CommunityMentionWeightInput): number {
  return encodeKnowledgeRef(left.chunkRef).localeCompare(encodeKnowledgeRef(right.chunkRef)) || left.entityId.localeCompare(right.entityId)
}

function compareChunks(left: CommunityChunkInput, right: CommunityChunkInput): number {
  return left.sourceId.localeCompare(right.sourceId) || left.ordinal - right.ordinal || left.chunkId.localeCompare(right.chunkId)
}
