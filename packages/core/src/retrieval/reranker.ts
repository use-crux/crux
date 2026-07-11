/**
 * Provider-agnostic retrieval reranking contracts.
 *
 * `Reranker` is the small public contract used by recipe `rerank()` steps.
 * Adapter packages bind provider-specific rerank or generation capabilities
 * into this shape; core also provides the shared LLM-judge implementation.
 *
 * @module
 */

import { z } from 'zod'
import type { RetrievalModel } from './model'
import type { RetrieverHit } from './types'

/** A provider-agnostic reranking engine for retrieved hits. */
export interface Reranker {
  /** Stable reranker name for inspection, docs, and traces. */
  name: string
  /** Return hits ranked best-first for the query. */
  rerank(args: { query: string; hits: readonly RetrieverHit[] }): Promise<RetrieverHit[]>
}

/** Configuration for {@link judgeReranker}. */
export interface JudgeRerankerConfig {
  /** Bound retrieval model used as the LLM judge. */
  model: RetrievalModel
  /**
   * Stable, authored reranker name. Required: it is the canonical
   * `rag.reranker:<safeId(name)>` identity the Project Index and runtime
   * evidence join on, so an anonymous default would collide across every
   * unnamed judge reranker.
   */
  name: string
  /** Maximum ranked items requested from the judge. Omitted hits are appended. */
  topN?: number
  /** Project a hit into the document text shown to the judge. Defaults to `hit.content`. */
  document?: (hit: RetrieverHit) => string
}

/** Create the shared LLM-judge reranker for an explicit recipe `rerank({ engine })`. */
export function judgeReranker(config: JudgeRerankerConfig): Reranker {
  const name = config.name
  return Object.freeze({
    name,
    async rerank(args: { query: string; hits: readonly RetrieverHit[] }): Promise<RetrieverHit[]> {
      const { query, hits } = args
      if (hits.length === 0) return []
      const rankedCount = config.topN ?? hits.length
      const result = await config.model.generateObject({
        system:
          'Rerank retrieved chunks for relevance to the query. Return hit indexes ranked best-first with optional relevance scores from 0 to 1.',
        prompt: renderJudgePrompt({
          query,
          topN: rankedCount,
          hits,
          document: config.document,
        }),
        schema: z.object({
          rankings: z.array(
            z.object({
              index: z.number().int(),
              score: z.number().finite().min(0).max(1).nullable(),
            }),
          ),
        }),
      })

      return materializeRankings(hits, result.object.rankings.slice(0, rankedCount))
    },
  })
}

function renderJudgePrompt(args: {
  query: string
  topN: number
  hits: readonly RetrieverHit[]
  document: ((hit: RetrieverHit) => string) | undefined
}): string {
  return [
    `Query: ${args.query}`,
    `Return up to ${args.topN} hit indexes ranked best-first.`,
    '',
    ...args.hits.map((hit, index) => `[${index}] ${args.document ? args.document(hit) : hit.content}`),
  ].join('\n')
}

function materializeRankings(
  hits: readonly RetrieverHit[],
  rankings: readonly { index: number; score: number | null }[],
): RetrieverHit[] {
  const seen = new Set<number>()
  const reranked: RetrieverHit[] = []
  const validRankings = rankings.filter((ranking) => ranking.index >= 0 && ranking.index < hits.length)

  validRankings.forEach((ranking, rankIndex) => {
    if (seen.has(ranking.index)) return
    const hit = hits[ranking.index]
    if (!hit) return
    seen.add(ranking.index)
    const score = ranking.score ?? fallbackScore(rankIndex, validRankings.length)
    reranked.push({
      ...hit,
      score,
      provenance: {
        ...hit.provenance,
        rerankScore: score,
      },
    })
  })

  hits.forEach((hit, index) => {
    if (!seen.has(index)) reranked.push(hit)
  })
  return reranked
}

function fallbackScore(index: number, length: number): number {
  return 1 - index / Math.max(1, length)
}
