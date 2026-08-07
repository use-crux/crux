/**
 * Deterministic community clustering for connected knowledge.
 *
 * @module
 */

import { createStableId } from '../../indexing/hash'
import { encodeKnowledgeRef } from '../refs'
import { agglomerateWithinBudget, type AgglomerationLink } from './cluster-split'
import { buildParentTree, finalizeRoot } from './cluster-parents'
import { normalizeCommunityGraphInput } from './cluster-normalize'
import {
  ASSERTION_REPORT_BOUNDARY_RELATION_LIMIT,
  boundedAssertionReportData,
  projectAssertionCommunities,
} from './assertion-policy'
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
  const assertionProjection = projectAssertionCommunities({
    chunks: normalized.chunks, mentionWeights: normalized.mentionWeights,
    assertions: normalized.assertions ?? [], relations: normalized.assertionRelations ?? [], leafByChunk: new Map(),
  })
  const heterogeneous = heterogeneousGraph(normalized, assertionProjection)
  const graphLeaves = heterogeneousLeafDrafts(normalized, heterogeneous, assertionProjection, budget)
  const includedChunks = new Set(graphLeaves.flatMap((leaf) => leaf.chunkRefs.map(encodeKnowledgeRef)))
  const fallbackLeaves = fallbackLeafDrafts(normalized.residualChunks.filter((chunk) => !includedChunks.has(encodeKnowledgeRef(chunk.ref))), budget)
  const leaves = [...graphLeaves, ...fallbackLeaves]
  assignAssertions(leaves, normalized)
  const communities = new Map<string, CommunityDraft>()
  for (const leaf of leaves) communities.set(leaf.communityId, leaf)

  const entityRoots = buildParentTree({
    leaves: graphLeaves,
    edges: normalized.edges,
    assertionRelations: assertionProjection.relations,
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

function heterogeneousGraph(
  input: CommunityGraphInput,
  assertions: ReturnType<typeof projectAssertionCommunities>,
): { readonly memberIds: readonly string[]; readonly links: readonly AgglomerationLink[]; readonly componentLinks: readonly AgglomerationLink[] } {
  const entityIds = input.entities.map((entity) => entityNode(entity.entityId))
  const chunkIds = new Set(input.mentionWeights.map((mention) => chunkNode(mention.chunkRef)))
  for (const chunk of input.residualChunks) chunkIds.add(chunkNode(chunk.ref))
  const assertionIds = assertions.assertions.map((assertion) => assertionNode(assertion.assertionId))
  const links: AgglomerationLink[] = input.edges.map((edge) => ({
    leftId: entityNode(edge.leftEntityId), rightId: entityNode(edge.rightEntityId), weight: edge.weight,
  }))
  const componentLinks = [...links]
  const residualBySource = new Map<string, CommunityChunkInput[]>()
  for (const chunk of [...input.residualChunks].sort(compareChunks)) {
    const source = residualBySource.get(chunk.sourceId) ?? []
    source.push(chunk)
    residualBySource.set(chunk.sourceId, source)
  }
  for (const chunks of residualBySource.values()) {
    for (let index = 1; index < chunks.length; index += 1) componentLinks.push({
      leftId: chunkNode(chunks[index - 1]?.ref ?? chunks[0]!.ref), rightId: chunkNode(chunks[index]!.ref), weight: 0,
    })
  }
  for (const mention of input.mentionWeights) {
    const chunkId = chunkNode(mention.chunkRef)
    chunkIds.add(chunkId)
    const link = { leftId: chunkId, rightId: entityNode(mention.entityId), weight: mention.weight }
    links.push(link)
    componentLinks.push(link)
  }
  for (const support of assertions.supports) {
    const chunkId = chunkNode(support.chunkRef)
    chunkIds.add(chunkId)
    const link = { leftId: assertionNode(support.assertionId), rightId: chunkId, weight: support.weight }
    links.push(link)
    componentLinks.push(link)
  }
  for (const affinity of assertions.entityAffinities) {
    const link = {
      leftId: assertionNode(affinity.assertionId), rightId: entityNode(affinity.entityId), weight: affinity.weight,
    }
    links.push(link)
    componentLinks.push(link)
  }
  for (const relation of assertions.relations) {
    const link = {
      leftId: assertionNode(relation.fromAssertionId), rightId: assertionNode(relation.toAssertionId), weight: relation.weight,
    }
    links.push(link)
    componentLinks.push(link)
  }
  return { memberIds: [...entityIds, ...chunkIds, ...assertionIds].sort(), links, componentLinks }
}

function heterogeneousLeafDrafts(
  input: CommunityGraphInput,
  graph: ReturnType<typeof heterogeneousGraph>,
  assertions: ReturnType<typeof projectAssertionCommunities>,
  budget: number,
): CommunityDraft[] {
  const components = connectedNodeComponents(graph.memberIds, graph.componentLinks)
  return components.flatMap((component) => agglomerateWithinBudget({
    memberIds: component,
    links: graph.links,
    budget,
    estimate: (ids) => estimateHeterogeneousMembers(ids, input, assertions),
  }).map((ids) => heterogeneousLeaf(ids, input, assertions))).sort(compareDrafts)
}

function heterogeneousLeaf(
  memberIds: readonly string[],
  input: CommunityGraphInput,
  assertions: ReturnType<typeof projectAssertionCommunities>,
): CommunityDraft {
  const entities = memberIds.filter((id) => id.startsWith('entity:')).map((id) => id.slice('entity:'.length)).sort()
  const chunkKeys = new Set(memberIds.filter((id) => id.startsWith('chunk:')))
  const chunkRefs = input.chunks.filter((chunk) => chunkKeys.has(encodeKnowledgeRef(chunk.ref))).map((chunk) => chunk.ref).sort(compareChunkRefs)
  const identities = [...entities.map((id) => `entity:${id}`), ...chunkRefs.map((ref) => `chunk:${encodeKnowledgeRef(ref)}`)].sort()
  return {
    communityId: communityId(identities), level: 0, kind: entities.length ? 'entity' : 'fallback', childCommunityIds: [],
    entityIds: entities, chunkRefs, estimatedInputChars: estimateHeterogeneousMembers(memberIds, input, assertions), memberIdentities: identities,
    primaryAssertionIds: [], secondaryAssertionIds: [],
  }
}

function estimateHeterogeneousMembers(
  memberIds: readonly string[],
  input: CommunityGraphInput,
  projection: ReturnType<typeof projectAssertionCommunities>,
): number {
  const members = new Set(memberIds)
  const selectedEntities = new Set(input.entities.filter((entity) => members.has(entityNode(entity.entityId))).map((entity) => entity.entityId))
  const selectedChunks = new Set(input.chunks.filter((chunk) => members.has(chunkNode(chunk.ref))).map((chunk) => encodeKnowledgeRef(chunk.ref)))
  for (const mention of input.mentionWeights) {
    if (selectedEntities.has(mention.entityId)) selectedChunks.add(encodeKnowledgeRef(mention.chunkRef))
  }
  const assertionIds = new Set(projection.assertions.filter((assertion) => assertion.evidence.some((support) =>
    selectedChunks.has(encodeKnowledgeRef(support.chunkRef)))).map((assertion) => assertion.assertionId))
  const internalRelations = projection.relations.filter((relation) =>
    assertionIds.has(relation.fromAssertionId) && assertionIds.has(relation.toAssertionId))
  const boundaryRelations = projection.relations.filter((relation) =>
    assertionIds.has(relation.fromAssertionId) !== assertionIds.has(relation.toAssertionId))
    .slice(0, ASSERTION_REPORT_BOUNDARY_RELATION_LIMIT)
  const entities = input.entities.filter((entity) => members.has(entityNode(entity.entityId)))
  const chunks = input.chunks.filter((chunk) => selectedChunks.has(encodeKnowledgeRef(chunk.ref)))
  const assertions = projection.assertions.filter((assertion) => assertionIds.has(assertion.assertionId))
  const relations = [...internalRelations, ...boundaryRelations]
  return 320 +
    entities.reduce((sum, entity) => sum + entityInputSize(entity) + 2, 0) +
    chunks.reduce((sum, chunk) => sum + chunk.content.length + encodeKnowledgeRef(chunk.ref).length + 4, 0) +
    assertions.reduce((sum, assertion) => sum + assertion.assertionId.length + assertion.type.length + boundedAssertionReportData(assertion.data).length + 5, 0) +
    relations.reduce((sum, relation) => sum + relation.relationId.length + relation.type.length +
      relation.fromAssertionId.length + relation.toAssertionId.length + 16, 0)
}

function connectedNodeComponents(memberIds: readonly string[], links: readonly AgglomerationLink[]): readonly (readonly string[])[] {
  const adjacency = new Map(memberIds.map((id) => [id, new Set<string>()]))
  for (const link of links) {
    if (!adjacency.has(link.leftId) || !adjacency.has(link.rightId)) continue
    adjacency.get(link.leftId)?.add(link.rightId)
    adjacency.get(link.rightId)?.add(link.leftId)
  }
  const seen = new Set<string>()
  return [...adjacency.keys()].sort().flatMap((start) => {
    if (seen.has(start)) return []
    const pending = [start]
    const component: string[] = []
    while (pending.length) {
      const id = pending.pop()
      if (!id || seen.has(id)) continue
      seen.add(id)
      component.push(id)
      pending.push(...[...(adjacency.get(id) ?? [])].filter((next) => !seen.has(next)).sort().reverse())
    }
    return [component.sort()]
  })
}

function entityNode(entityId: string): string { return `entity:${entityId}` }
function assertionNode(assertionId: string): string { return `assertion:${assertionId}` }
function chunkNode(ref: CommunityChunkRef): string { return encodeKnowledgeRef(ref) }

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

function entityInputSize(entity: CommunityEntityInput | undefined): number {
  if (!entity) return 0
  return [entity.canonicalName, entity.description ?? '', ...(entity.aliases ?? [])].join('\n').length
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
