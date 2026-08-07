/** Internal, versioned assertion projection policy for knowledge communities. */

import type { JsonValue } from '../../storage'
import type { AssertionSupport } from '../assertions/identity'
import { encodeKnowledgeRef } from '../refs'
import type { CommunityChunkInput, CommunityMentionWeightInput } from './types'
import type { CommunityEntityEdgeInput } from './types'

export const ASSERTION_MEMBERSHIP_POLICY_VERSION = 'assertion-community-v1'
export const ASSERTION_REPORT_PROMPT_VERSION = 'assertion-report-v2'
export const ASSERTION_REPORT_DATA_LIMIT = 1_200
export const ASSERTION_REPORT_INTERNAL_RELATION_LIMIT = 40
export const ASSERTION_REPORT_BOUNDARY_RELATION_LIMIT = 20

export function boundedAssertionReportData(data: JsonValue): string {
  const value = JSON.stringify(data)
  return value.length <= ASSERTION_REPORT_DATA_LIMIT ? value : value.slice(0, ASSERTION_REPORT_DATA_LIMIT)
}

const relationWeights = {
  supports: 1,
  conflictsWith: 1,
  amends: 0.75,
  narrows: 0.75,
  supersedes: 1.25,
} as const

export interface CommunityAssertionInput {
  readonly assertionId: string
  readonly type: string
  readonly data: JsonValue
  readonly evidence: readonly AssertionSupport[]
}

export interface CommunityAssertionRelationInput {
  readonly relationId: string
  readonly type: keyof typeof relationWeights
  readonly fromAssertionId: string
  readonly toAssertionId: string
}

export interface AssertionCommunityMembership {
  readonly assertionId: string
  readonly primaryCommunityId: string
  readonly secondaryCommunityIds: readonly string[]
}

export function projectAssertionCommunities(input: {
  readonly chunks: readonly CommunityChunkInput[]
  readonly mentionWeights: readonly CommunityMentionWeightInput[]
  readonly assertions: readonly CommunityAssertionInput[]
  readonly relations: readonly CommunityAssertionRelationInput[]
  readonly leafByChunk: ReadonlyMap<string, string>
}) {
  const chunks = new Set(input.chunks.map((chunk) => encodeKnowledgeRef(chunk.ref)))
  const entitiesByChunk = new Map<string, Set<string>>()
  for (const mention of input.mentionWeights) {
    const key = encodeKnowledgeRef(mention.chunkRef)
    if (!chunks.has(key)) continue
    const entities = entitiesByChunk.get(key) ?? new Set<string>()
    entities.add(mention.entityId)
    entitiesByChunk.set(key, entities)
  }

  const visible = input.assertions.map((assertion) => ({
    ...assertion,
    evidence: [...new Map(assertion.evidence
      .filter((support) => chunks.has(encodeKnowledgeRef(support.chunkRef)))
      .map((support) => [encodeKnowledgeRef(support.chunkRef), support])).values()]
      .sort((left, right) => encodeKnowledgeRef(left.chunkRef).localeCompare(encodeKnowledgeRef(right.chunkRef))),
  })).filter((assertion) => assertion.evidence.length > 0)
    .sort((left, right) => left.assertionId.localeCompare(right.assertionId))

  const assertionsPerSource = new Map<string, Set<string>>()
  for (const assertion of visible) {
    for (const sourceId of new Set(assertion.evidence.map((support) => support.sourceId))) {
      const ids = assertionsPerSource.get(sourceId) ?? new Set<string>()
      ids.add(assertion.assertionId)
      assertionsPerSource.set(sourceId, ids)
    }
  }
  const volume = (assertion: typeof visible[number]) => Math.max(1, ...assertion.evidence.map((support) =>
    assertionsPerSource.get(support.sourceId)?.size ?? 1))
  const sourceScale = (sourceId: string) => 1 / Math.sqrt(Math.max(1, assertionsPerSource.get(sourceId)?.size ?? 1))

  const supports = visible.flatMap((assertion) => assertion.evidence.map((support) => ({
    assertionId: assertion.assertionId,
    chunkRef: support.chunkRef,
    weight: 1 / assertion.evidence.length * sourceScale(support.sourceId),
  })))

  const entityAffinities = visible.flatMap((assertion) => {
    const totals = new Map<string, number>()
    for (const support of assertion.evidence) {
      const entities = [...(entitiesByChunk.get(encodeKnowledgeRef(support.chunkRef)) ?? [])].sort()
      for (const entityId of entities) {
        const contribution = 1 / assertion.evidence.length / Math.max(1, entities.length) * sourceScale(support.sourceId)
        totals.set(entityId, Math.min(1, (totals.get(entityId) ?? 0) + contribution))
      }
    }
    return [...totals.entries()].map(([entityId, weight]) => ({
      assertionId: assertion.assertionId,
      entityId,
      weight,
    }))
  }).sort((left, right) => left.assertionId.localeCompare(right.assertionId) || left.entityId.localeCompare(right.entityId))

  const assertionById = new Map(visible.map((assertion) => [assertion.assertionId, assertion]))
  const degrees = new Map<string, number>()
  const visibleRelations = input.relations.filter((relation) =>
    relation.type in relationWeights && assertionById.has(relation.fromAssertionId) && assertionById.has(relation.toAssertionId))
  for (const relation of visibleRelations) {
    degrees.set(relation.fromAssertionId, (degrees.get(relation.fromAssertionId) ?? 0) + 1)
    degrees.set(relation.toAssertionId, (degrees.get(relation.toAssertionId) ?? 0) + 1)
  }
  const relations = visibleRelations.map((relation) => {
    const from = assertionById.get(relation.fromAssertionId)
    const to = assertionById.get(relation.toAssertionId)
    const sourceVolume = Math.max(from ? volume(from) : 1, to ? volume(to) : 1)
    return {
      ...relation,
      weight: relationWeights[relation.type] /
        Math.max(1, degrees.get(relation.fromAssertionId) ?? 0, degrees.get(relation.toAssertionId) ?? 0) /
        Math.sqrt(sourceVolume),
    }
  }).sort((left, right) => left.relationId.localeCompare(right.relationId))

  const memberships = projectAssertionMemberships(visible, input.leafByChunk)

  return { assertions: visible, supports, entityAffinities, relations, memberships }
}

export function projectAssertionMemberships(
  assertions: readonly CommunityAssertionInput[],
  leafByChunk: ReadonlyMap<string, string>,
): readonly AssertionCommunityMembership[] {
  const assertionsPerSource = new Map<string, Set<string>>()
  for (const assertion of assertions) {
    for (const sourceId of new Set(assertion.evidence.map((support) => support.sourceId))) {
      const ids = assertionsPerSource.get(sourceId) ?? new Set<string>()
      ids.add(assertion.assertionId)
      assertionsPerSource.set(sourceId, ids)
    }
  }
  const sourceScale = (sourceId: string) => 1 / Math.sqrt(Math.max(1, assertionsPerSource.get(sourceId)?.size ?? 1))
  return assertions.flatMap((assertion): AssertionCommunityMembership[] => {
    const candidates = assertion.evidence.flatMap((support) => {
      const chunkKey = encodeKnowledgeRef(support.chunkRef)
      const communityId = leafByChunk.get(chunkKey)
      return communityId ? [{ communityId, chunkKey, weight: 1 / assertion.evidence.length * sourceScale(support.sourceId) }] : []
    }).sort((left, right) => right.weight - left.weight || left.communityId.localeCompare(right.communityId) ||
      left.chunkKey.localeCompare(right.chunkKey))
    const primary = candidates[0]
    if (!primary) return []
    return [{
      assertionId: assertion.assertionId,
      primaryCommunityId: primary.communityId,
      secondaryCommunityIds: [...new Set(candidates.map((candidate) => candidate.communityId))]
        .filter((communityId) => communityId !== primary.communityId).sort(),
    }]
  })
}

/** Collapse the heterogeneous assertion projection into entity links consumed by the existing clusterer. */
export function assertionEntityEdges(input: Parameters<typeof projectAssertionCommunities>[0]): readonly CommunityEntityEdgeInput[] {
  const projection = projectAssertionCommunities(input)
  const entitiesByAssertion = new Map<string, string[]>()
  const affinitiesByAssertion = new Map<string, typeof projection.entityAffinities[number][]>()
  for (const affinity of projection.entityAffinities) {
    const ids = entitiesByAssertion.get(affinity.assertionId) ?? []
    ids.push(affinity.entityId)
    entitiesByAssertion.set(affinity.assertionId, ids)
    const affinities = affinitiesByAssertion.get(affinity.assertionId) ?? []
    affinities.push(affinity)
    affinitiesByAssertion.set(affinity.assertionId, affinities)
  }
  const weights = new Map<string, number>()
  const add = (left: string, right: string, weight: number) => {
    if (left === right || weight <= 0) return
    const key = left < right ? `${left}\0${right}` : `${right}\0${left}`
    weights.set(key, (weights.get(key) ?? 0) + weight)
  }
  for (const assertion of projection.assertions) {
    const affinities = affinitiesByAssertion.get(assertion.assertionId) ?? []
    for (let left = 0; left < affinities.length; left += 1) {
      for (let right = left + 1; right < affinities.length; right += 1) {
        add(affinities[left]?.entityId ?? '', affinities[right]?.entityId ?? '',
          Math.min(affinities[left]?.weight ?? 0, affinities[right]?.weight ?? 0))
      }
    }
  }
  for (const relation of projection.relations) {
    const from = [...new Set(entitiesByAssertion.get(relation.fromAssertionId) ?? [])].sort()
    const to = [...new Set(entitiesByAssertion.get(relation.toAssertionId) ?? [])].sort()
    const divisor = Math.max(1, from.length * to.length)
    for (const left of from) for (const right of to) add(left, right, relation.weight / divisor)
  }
  return [...weights.entries()].flatMap(([key, weight]) => {
    const [leftEntityId, rightEntityId] = key.split('\0')
    return leftEntityId && rightEntityId ? [{ leftEntityId, rightEntityId, weight }] : []
  }).sort((left, right) => left.leftEntityId.localeCompare(right.leftEntityId) || left.rightEntityId.localeCompare(right.rightEntityId))
}
