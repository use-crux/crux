/**
 * Query fan-out option merging and hit fusion.
 *
 * Merges per-query filters into retrieve options and fuses hit groups from
 * multiple planned queries using reciprocal-rank fusion (RRF), annotating each
 * fused hit with its matched queries, ranks, and scores.
 *
 * @module
 */

import type { PlannedRetrievalQuery, RetrieveOptions, RetrieverHit } from './types'

/** Merge a planned query's filter into the base retrieve options. */
export function mergeRetrieveOptions(options: RetrieveOptions, planned: PlannedRetrievalQuery): RetrieveOptions {
  return {
    ...options,
    filter: {
      ...(options.filter ?? {}),
      ...(planned.filter ?? {}),
    },
  }
}

/** Fuse hit groups from multiple queries via reciprocal-rank fusion. */
export function mergeHitGroups(
  groups: Array<{ planned: PlannedRetrievalQuery; hits: RetrieverHit[] }>,
): RetrieverHit[] {
  const merged = new Map<
    string,
    {
      hit: RetrieverHit
      matchedQueries: string[]
      queryReasons: string[]
      ranks: number[]
      rawScores: number[]
      fusedScore: number
    }
  >()
  const k = 60

  groups.forEach((group) => {
    group.hits.forEach((hitItem, index) => {
      const identity = hitIdentity(hitItem)
      const rank = index + 1
      const current = merged.get(identity) ?? {
        hit: hitItem,
        matchedQueries: [],
        queryReasons: [],
        ranks: [],
        rawScores: [],
        fusedScore: 0,
      }
      current.matchedQueries.push(group.planned.query)
      if (group.planned.reason) current.queryReasons.push(group.planned.reason)
      current.ranks.push(rank)
      current.rawScores.push(hitItem.score)
      current.fusedScore += (group.planned.weight ?? 1) / (k + rank)
      if (hitItem.score > current.hit.score) current.hit = hitItem
      merged.set(identity, current)
    })
  })

  return [...merged.values()]
    .sort((a, b) => b.fusedScore - a.fusedScore || Math.max(...b.rawScores) - Math.max(...a.rawScores))
    .map((item) => ({
      ...item.hit,
      score: Math.max(...item.rawScores),
      metadata: {
        ...item.hit.metadata,
        _cruxRetrieval: {
          matchedQueries: item.matchedQueries,
          ...(item.queryReasons.length ? { queryReasons: item.queryReasons } : {}),
          ranks: item.ranks,
          rawScores: item.rawScores,
          fusedScore: item.fusedScore,
        },
      },
    }))
}

function hitIdentity(hit: Pick<RetrieverHit, 'namespace' | 'sourceId' | 'chunkId'>): string {
  return `${hit.namespace}/${hit.sourceId}/${hit.chunkId}`
}
