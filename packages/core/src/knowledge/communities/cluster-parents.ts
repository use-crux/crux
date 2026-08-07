/**
 * Parent and root construction for deterministic knowledge communities.
 *
 * @module
 */

import { createStableId } from '../../indexing/hash'
import { encodeKnowledgeRef } from '../refs'
import { agglomerateWithinBudget, type AgglomerationLink } from './cluster-split'
import type { CommunityDraft, CommunityEntityEdgeInput } from './types'

/** Build bounded parent communities above entity leaves. */
export function buildParentTree(input: {
  readonly leaves: readonly CommunityDraft[]
  readonly edges: readonly CommunityEntityEdgeInput[]
  readonly communities: Map<string, CommunityDraft>
  readonly parentBudget: number
}): readonly string[] {
  let current = input.leaves.map((leaf) => leaf.communityId).sort()
  let level = 1
  while (current.length > 1) {
    const groups = agglomerateWithinBudget({
      memberIds: current,
      links: parentLinks(current, input.communities, input.edges),
      budget: input.parentBudget,
      estimate: (ids) => ids.reduce((total, id) => total + parentInputSize(input.communities.get(id)), 0),
    })
    if (groups.length === current.length) return current

    current = groups.map((group) => {
      if (group.length === 1) return group[0] ?? ''
      const parent = parentDraft(group, input.communities, level)
      input.communities.set(parent.communityId, parent)
      for (const childId of group) {
        const child = input.communities.get(childId)
        if (child) child.parentCommunityId = parent.communityId
      }
      return parent.communityId
    }).filter(Boolean).sort()
    level += 1
  }
  return current
}

/** Create or promote the single corpus root. */
export function finalizeRoot(
  childIds: readonly string[],
  communities: Map<string, CommunityDraft>,
): string {
  if (childIds.length === 0) {
    const root = emptyRoot()
    communities.set(root.communityId, root)
    return root.communityId
  }
  if (childIds.length === 1) {
    const only = communities.get(childIds[0] ?? '')
    if (!only) throw new Error('Community root child is missing.')
    only.kind = 'root'
    return only.communityId
  }

  const root = parentDraft(childIds, communities, maxLevel(communities) + 1)
  root.kind = 'root'
  communities.set(root.communityId, root)
  for (const childId of childIds) {
    const child = communities.get(childId)
    if (child) child.parentCommunityId = root.communityId
  }
  return root.communityId
}

function parentDraft(childIds: readonly string[], communities: ReadonlyMap<string, CommunityDraft>, level: number): CommunityDraft {
  const children = [...childIds].sort()
  const childCommunities = children.map((id) => {
    const child = communities.get(id)
    if (!child) throw new Error(`Community child "${id}" is missing.`)
    return child
  })
  const memberIdentities = [...new Set(childCommunities.flatMap((child) => child.memberIdentities))].sort()
  return {
    communityId: communityId(memberIdentities),
    level,
    kind: 'parent',
    childCommunityIds: children,
    entityIds: [...new Set(childCommunities.flatMap((child) => child.entityIds))].sort(),
    chunkRefs: childCommunities.flatMap((child) => child.chunkRefs).sort(compareChunkRefs),
    estimatedInputChars: childCommunities.reduce((total, child) => total + parentInputSize(child), 0),
    memberIdentities,
    primaryAssertionIds: [...new Set(childCommunities.flatMap((child) => child.primaryAssertionIds))].sort(),
    secondaryAssertionIds: [...new Set(childCommunities.flatMap((child) => child.secondaryAssertionIds))].sort(),
  }
}

function parentLinks(
  currentIds: readonly string[],
  communities: ReadonlyMap<string, CommunityDraft>,
  edges: readonly CommunityEntityEdgeInput[],
): readonly AgglomerationLink[] {
  const communityByEntity = new Map<string, string>()
  for (const id of currentIds) {
    const community = communities.get(id)
    for (const entityId of community?.entityIds ?? []) communityByEntity.set(entityId, id)
  }
  const weights = new Map<string, number>()
  for (const edge of edges) {
    const leftId = communityByEntity.get(edge.leftEntityId)
    const rightId = communityByEntity.get(edge.rightEntityId)
    if (!leftId || !rightId || leftId === rightId) continue
    const key = pairKey(leftId, rightId)
    weights.set(key, (weights.get(key) ?? 0) + edge.weight)
  }
  return [...weights.entries()].flatMap(([key, weight]) => {
    const [leftId, rightId] = key.split('\0')
    return leftId && rightId ? [{ leftId, rightId, weight }] : []
  })
}

function emptyRoot(): CommunityDraft {
  return {
    communityId: communityId([]),
    level: 0,
    kind: 'root',
    childCommunityIds: [],
    entityIds: [],
    chunkRefs: [],
    estimatedInputChars: 0,
    memberIdentities: [],
    primaryAssertionIds: [],
    secondaryAssertionIds: [],
  }
}

function parentInputSize(community: CommunityDraft | undefined): number {
  return Math.min(community?.estimatedInputChars ?? 0, 2_000)
}

function communityId(memberIdentities: readonly string[]): string {
  return createStableId('community', [...memberIdentities].sort())
}

function maxLevel(communities: ReadonlyMap<string, CommunityDraft>): number {
  return Math.max(0, ...[...communities.values()].map((community) => community.level))
}

function pairKey(left: string, right: string): string {
  return left <= right ? `${left}\0${right}` : `${right}\0${left}`
}

function compareChunkRefs(left: { readonly sourceId: string; readonly chunkId: string }, right: { readonly sourceId: string; readonly chunkId: string }): number {
  return encodeKnowledgeRef({ kind: 'chunk', sourceId: left.sourceId, chunkId: left.chunkId })
    .localeCompare(encodeKnowledgeRef({ kind: 'chunk', sourceId: right.sourceId, chunkId: right.chunkId }))
}
