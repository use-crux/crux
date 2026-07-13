/**
 * Query fanout option merging and single-source RRF fusion for recipes.
 *
 * @module
 */

import type { RetrieveOptions, RetrieveRequest } from '../request'
import type { HitProvenance, RetrieverHit } from '../types'
import type { NormalizedRecipeSource } from './source'
import type { PlannedQuery } from './step'

type SourceProvenance = NonNullable<HitProvenance['perSource']>[number]

/** Merge a planned query and retrieve-step config into a canonical request. */
export function mergeRetrieveOptions(
  request: RetrieveRequest,
  planned: PlannedQuery,
  stepConfig: { limit?: number; threshold?: number } | undefined,
): RetrieveOptions {
  const filter = {
    ...(request.filter ?? {}),
    ...(planned.filter ?? {}),
  }
  return {
    ...(request.limit !== undefined ? { limit: request.limit } : {}),
    ...(request.threshold !== undefined ? { threshold: request.threshold } : {}),
    ...(request.mode ? { mode: request.mode } : {}),
    ...(request.fusion ? { fusion: request.fusion } : {}),
    ...(request.caller ? { caller: request.caller } : {}),
    ...(stepConfig?.limit !== undefined ? { limit: stepConfig.limit } : {}),
    ...(stepConfig?.threshold !== undefined ? { threshold: stepConfig.threshold } : {}),
    ...(Object.keys(filter).length ? { filter } : {}),
  }
}

/** Fuse hit groups from planned queries while keeping `hit.score` in the current score currency. */
export function fuseQueryGroups(
  groups: readonly { planned: PlannedQuery; hits: readonly RetrieverHit[]; source?: NormalizedRecipeSource }[],
  k = 60,
): RetrieverHit[] {
  if (groups.length === 1) {
    return groups[0].hits.map((hit, rank) => ({
      ...hit,
      provenance: {
        ...hit.provenance,
        rawScore: hit.provenance?.rawScore ?? hit.score,
        matchedQueries: [groups[0].planned.query],
        ranks: [rank + 1],
      },
    }))
  }

  const merged = new Map<
    string,
    {
      hit: RetrieverHit
      matchedQueries: string[]
      ranks: number[]
      rawScores: number[]
      perSource: SourceProvenance[]
      fusedScore: number
    }
  >()

  for (const group of groups) {
    group.hits.forEach((hit, index) => {
      const rank = index + 1
      const key = hitIdentity(hit)
      const current = merged.get(key) ?? {
        hit,
        matchedQueries: [],
        ranks: [],
        rawScores: [],
        perSource: [],
        fusedScore: 0,
      }
      if (!current.matchedQueries.includes(group.planned.query)) {
        current.matchedQueries.push(group.planned.query)
      }
      current.ranks.push(rank)
      current.rawScores.push(hit.score)
      const sourceWeight = group.source?.weight ?? 1
      current.fusedScore += ((group.planned.weight ?? 1) * sourceWeight) / (k + rank)
      if (group.source) {
        current.perSource.push({
          retrieverId: group.source.retriever.id,
          score: hit.score,
          rank,
          weight: group.source.weight,
        })
      }
      if (hit.score > current.hit.score) current.hit = hit
      merged.set(key, current)
    })
  }

  return [...merged.values()]
    .map((item) => ({
      ...item.hit,
      score: item.fusedScore,
      provenance: {
        ...item.hit.provenance,
        rawScore: item.hit.provenance?.rawScore ?? Math.max(...item.rawScores),
        matchedQueries: item.matchedQueries,
        ranks: item.ranks,
        fusedScore: item.fusedScore,
        ...(item.perSource.length ? { perSource: item.perSource } : {}),
      },
    }))
    .sort((left, right) => right.score - left.score)
}

function hitIdentity(hit: Pick<RetrieverHit, 'namespace' | 'source' | 'chunkId'>): string {
  return `${hit.namespace}/${hit.source.id}/${hit.chunkId}`
}
