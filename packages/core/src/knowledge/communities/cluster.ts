/**
 * Deterministic community clustering for connected knowledge.
 *
 * @module
 */

import { createStableId } from '../../indexing/hash'
import { encodeKnowledgeRef } from '../refs'
import { agglomerateWithinBudget } from './cluster-split'
import { buildParentTree, finalizeRoot } from './cluster-parents'
import { normalizeCommunityGraphInput } from './cluster-normalize'
import { assertionEntityEdges, projectAssertionCommunities } from './assertion-policy'
import type {
  CommunityChunkInput,
  CommunityChunkRef,
  CommunityDraft,
  CommunityEntityEdgeInput,
  CommunityEntityInput,
  CommunityGraphInput,
  CommunityMentionWeightInput,
  KnowledgeCommunity,
  KnowledgeCommunityClustering,
} from './types'

export type {
  CommunityChunkInput,
  CommunityChunkRef,
  CommunityEntityEdgeInput,
  CommunityEntityInput,
  CommunityGraphInput,
  CommunityMentionWeightInput,
  KnowledgeCommunity,
  KnowledgeCommunityClustering,
} from './types'

/** Leaf community report input budget, in characters. */
export const COMMUNITY_INPUT_BUDGET = 24_000

/** Parent communities use summary inputs bounded to this multiple. */
export const COMMUNITY_PARENT_BUDGET_MULTIPLE = 4

/** Parent community report input budget, in characters. */
export const PARENT_INPUT_BUDGET = COMMUNITY_INPUT_BUDGET * COMMUNITY_PARENT_BUDGET_MULTIPLE

/** Cluster the input graph into deterministic bounded communities. */
export function clusterKnowledgeCommunities(
  input: CommunityGraphInput,
  budget = COMMUNITY_INPUT_BUDGET,
): KnowledgeCommunityClustering {
  const normalized = normalizeCommunityGraphInput(input)
  const assertionEdges = assertionEntityEdges({
    chunks: normalized.chunks, mentionWeights: normalized.mentionWeights,
    assertions: normalized.assertions ?? [], relations: normalized.assertionRelations ?? [], leafByChunk: new Map(),
  })
  const clusteringInput = { ...normalized, edges: [...normalized.edges, ...assertionEdges] }
  const entityLeaves = entityLeafDrafts(clusteringInput, budget)
  assignMentionedChunks(entityLeaves, clusteringInput)
  const fallbackLeaves = fallbackLeafDrafts(normalized.residualChunks, budget)
  assignAssertions([...entityLeaves, ...fallbackLeaves], clusteringInput)
  const communities = new Map<string, CommunityDraft>()
  for (const leaf of [...entityLeaves, ...fallbackLeaves]) communities.set(leaf.communityId, leaf)

  const entityRoots = buildParentTree({
    leaves: entityLeaves,
    edges: clusteringInput.edges,
    communities,
    parentBudget: PARENT_INPUT_BUDGET,
  })
  const rootCommunityId = finalizeRoot(
    [...entityRoots, ...fallbackLeaves.map((leaf) => leaf.communityId)].sort(),
    communities,
  )
  const result = [...communities.values()].map(freezeCommunity).sort(compareCommunities)
  assertLeafBudgets(result, budget)
  return {
    rootCommunityId,
    communities: result,
    leaves: result.filter((community) => community.childCommunityIds.length === 0),
  }
}

function entityLeafDrafts(input: CommunityGraphInput, budget: number): CommunityDraft[] {
  const links = input.edges.map((edge) => ({
    leftId: edge.leftEntityId,
    rightId: edge.rightEntityId,
    weight: edge.weight,
  }))
  return connectedComponents(input.entities.map((entity) => entity.entityId), input.edges).flatMap((component) =>
    agglomerateWithinBudget({
      memberIds: component,
      links,
      budget,
      estimate: (entityIds) => estimateEntityMembers(entityIds, input),
    }).map((entityIds) => entityLeaf(entityIds, input)),
  ).sort(compareDrafts)
}

function entityLeaf(entityIds: readonly string[], input: CommunityGraphInput): CommunityDraft {
  const ids = [...entityIds].sort()
  const memberIdentities = ids.map((id) => `entity:${id}`)
  return {
    communityId: communityId(memberIdentities),
    level: 0,
    kind: 'entity',
    childCommunityIds: [],
    entityIds: ids,
    chunkRefs: [],
    estimatedInputChars: estimateEntityMembers(ids, input),
    memberIdentities,
    primaryAssertionIds: [],
    secondaryAssertionIds: [],
  }
}

function assignMentionedChunks(leaves: readonly CommunityDraft[], input: CommunityGraphInput): void {
  const leafByEntity = new Map(leaves.flatMap((leaf) => leaf.entityIds.map((id) => [id, leaf])))
  const chunkByKey = new Map(input.chunks.map((chunk) => [encodeKnowledgeRef(chunk.ref), chunk]))
  for (const [chunkKey, mentions] of groupMentions(input.mentionWeights)) {
    const chunk = chunkByKey.get(chunkKey)
    if (!chunk) continue
    const target = mentions.flatMap((mention) => {
      const leaf = leafByEntity.get(mention.entityId)
      return leaf ? [{ ...mention, communityId: leaf.communityId, leaf }] : []
    }).sort(compareMentionChoice)[0]?.leaf
    if (!target) continue
    target.chunkRefs = [...target.chunkRefs, chunk.ref].sort(compareChunkRefs)
    target.estimatedInputChars = estimateLeafInput(target, input)
  }
}

function fallbackLeafDrafts(chunks: readonly CommunityChunkInput[], budget: number): readonly CommunityDraft[] {
  const groups = new Map<string, CommunityChunkInput[]>()
  for (const chunk of [...chunks].sort(compareChunks)) {
    const group = groups.get(chunk.sourceId) ?? []
    group.push(chunk)
    groups.set(chunk.sourceId, group)
  }
  return [...groups.values()].flatMap((sourceChunks) => splitFallbackSource(sourceChunks, budget)).sort(compareDrafts)
}

function splitFallbackSource(chunks: readonly CommunityChunkInput[], budget: number): readonly CommunityDraft[] {
  const leaves: CommunityDraft[] = []
  let batch: CommunityChunkInput[] = []
  let size = 0
  for (const chunk of chunks) {
    assertChunkWithinBudget(chunk, budget)
    if (batch.length > 0 && size + chunk.content.length > budget) {
      leaves.push(fallbackLeaf(batch))
      batch = []
      size = 0
    }
    batch.push(chunk)
    size += chunk.content.length
  }
  if (batch.length > 0) leaves.push(fallbackLeaf(batch))
  return leaves
}

function fallbackLeaf(chunks: readonly CommunityChunkInput[]): CommunityDraft {
  const chunkRefs = chunks.map((chunk) => chunk.ref).sort(compareChunkRefs)
  const memberIdentities = chunkRefs.map((ref) => `chunk:${encodeKnowledgeRef(ref)}`)
  return {
    communityId: communityId(memberIdentities),
    level: 0,
    kind: 'fallback',
    childCommunityIds: [],
    entityIds: [],
    chunkRefs,
    estimatedInputChars: chunks.reduce((total, chunk) => total + chunk.content.length, 0),
    memberIdentities,
    primaryAssertionIds: [],
    secondaryAssertionIds: [],
  }
}

function connectedComponents(entityIds: readonly string[], edges: readonly CommunityEntityEdgeInput[]): readonly (readonly string[])[] {
  const adjacency = new Map(entityIds.map((id) => [id, new Set<string>()]))
  for (const edge of edges) {
    if (!adjacency.has(edge.leftEntityId) || !adjacency.has(edge.rightEntityId)) continue
    adjacency.get(edge.leftEntityId)?.add(edge.rightEntityId)
    adjacency.get(edge.rightEntityId)?.add(edge.leftEntityId)
  }
  const seen = new Set<string>()
  return [...adjacency.keys()].sort().flatMap((start) => {
    if (seen.has(start)) return []
    const stack = [start]
    const component: string[] = []
    while (stack.length > 0) {
      const id = stack.pop() ?? ''
      if (!id || seen.has(id)) continue
      seen.add(id)
      component.push(id)
      for (const next of [...(adjacency.get(id) ?? [])].sort().reverse()) {
        if (!seen.has(next)) stack.push(next)
      }
    }
    return [component.sort()]
  })
}

function estimateEntityMembers(entityIds: readonly string[], input: CommunityGraphInput): number {
  const entitySet = new Set(entityIds)
  const chunks = new Set<string>()
  for (const mention of input.mentionWeights) {
    if (entitySet.has(mention.entityId)) chunks.add(encodeKnowledgeRef(mention.chunkRef))
  }
  const chunkByKey = new Map(input.chunks.map((chunk) => [encodeKnowledgeRef(chunk.ref), chunk]))
  return entityIds.reduce((total, id) => total + entityInputSize(input.entities.find((entity) => entity.entityId === id)), 0) +
    [...chunks].reduce((total, key) => total + (chunkByKey.get(key)?.content.length ?? 0), 0)
}

function estimateLeafInput(leaf: CommunityDraft, input: CommunityGraphInput): number {
  const chunkByKey = new Map(input.chunks.map((chunk) => [encodeKnowledgeRef(chunk.ref), chunk]))
  return leaf.entityIds.reduce((total, id) => total + entityInputSize(input.entities.find((entity) => entity.entityId === id)), 0) +
    leaf.chunkRefs.reduce((total, ref) => total + (chunkByKey.get(encodeKnowledgeRef(ref))?.content.length ?? 0), 0)
}

function entityInputSize(entity: CommunityEntityInput | undefined): number {
  if (!entity) return 0
  return [entity.canonicalName, entity.description ?? '', ...(entity.aliases ?? [])].join('\n').length
}

function groupMentions(mentionWeights: readonly CommunityMentionWeightInput[]): ReadonlyMap<string, readonly MentionChoice[]> {
  const byChunk = new Map<string, MentionChoice[]>()
  for (const mention of mentionWeights) {
    const key = encodeKnowledgeRef(mention.chunkRef)
    const group = byChunk.get(key) ?? []
    group.push({ entityId: mention.entityId, weight: mention.weight, communityId: '' })
    byChunk.set(key, group)
  }
  return byChunk
}

function freezeCommunity(draft: CommunityDraft): KnowledgeCommunity {
  return Object.freeze({
    communityId: draft.communityId,
    level: draft.level,
    kind: draft.kind,
    ...(draft.parentCommunityId ? { parentCommunityId: draft.parentCommunityId } : {}),
    childCommunityIds: [...draft.childCommunityIds].sort(),
    entityIds: [...draft.entityIds].sort(),
    chunkRefs: [...draft.chunkRefs].sort(compareChunkRefs),
    estimatedInputChars: draft.estimatedInputChars,
    memberIdentities: [...draft.memberIdentities].sort(),
    primaryAssertionIds: [...draft.primaryAssertionIds].sort(),
    secondaryAssertionIds: [...draft.secondaryAssertionIds].sort(),
  })
}

function assignAssertions(leaves: readonly CommunityDraft[], input: CommunityGraphInput): void {
  const leafByChunk = new Map<string, string>()
  const leafById = new Map<string, CommunityDraft>()
  for (const leaf of leaves) {
    leafById.set(leaf.communityId, leaf)
    for (const ref of leaf.chunkRefs) leafByChunk.set(encodeKnowledgeRef(ref), leaf.communityId)
  }
  const projection = projectAssertionCommunities({
    chunks: input.chunks,
    mentionWeights: input.mentionWeights,
    assertions: input.assertions ?? [],
    relations: input.assertionRelations ?? [],
    leafByChunk,
  })
  for (const membership of projection.memberships) {
    const primary = leafById.get(membership.primaryCommunityId)
    if (primary) {
      primary.primaryAssertionIds.push(membership.assertionId)
      primary.memberIdentities.push(`assertion:${membership.assertionId}`)
    }
    for (const id of membership.secondaryCommunityIds) leafById.get(id)?.secondaryAssertionIds.push(membership.assertionId)
  }
  for (const leaf of leaves) leaf.communityId = communityId(leaf.memberIdentities)
}

interface MentionChoice {
  readonly entityId: string
  readonly weight: number
  readonly communityId: string
  readonly leaf?: CommunityDraft
}

function assertChunkWithinBudget(chunk: CommunityChunkInput, budget: number): void {
  if (chunk.content.length <= budget) return
  throw new Error(`Community fallback chunk "${encodeKnowledgeRef(chunk.ref)}" exceeds the input budget.`)
}

function assertLeafBudgets(communities: readonly KnowledgeCommunity[], budget: number): void {
  for (const community of communities) {
    if (community.childCommunityIds.length > 0 || community.estimatedInputChars <= budget) continue
    throw new Error(`Community "${community.communityId}" exceeds the input budget.`)
  }
}

function communityId(memberIdentities: readonly string[]): string {
  return createStableId('community', [...memberIdentities].sort())
}

function compareMentionChoice(left: MentionChoice, right: MentionChoice): number {
  return right.weight - left.weight || left.entityId.localeCompare(right.entityId) || left.communityId.localeCompare(right.communityId)
}

function compareChunks(left: CommunityChunkInput, right: CommunityChunkInput): number {
  return left.sourceId.localeCompare(right.sourceId) || left.ordinal - right.ordinal || left.chunkId.localeCompare(right.chunkId)
}

function compareChunkRefs(left: CommunityChunkRef, right: CommunityChunkRef): number {
  return encodeKnowledgeRef(left).localeCompare(encodeKnowledgeRef(right))
}

function compareDrafts(left: CommunityDraft, right: CommunityDraft): number {
  return left.communityId.localeCompare(right.communityId)
}

function compareCommunities(left: KnowledgeCommunity, right: KnowledgeCommunity): number {
  return left.level - right.level || left.communityId.localeCompare(right.communityId)
}
