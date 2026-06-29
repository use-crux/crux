/**
 * Built-in retrieval pipeline stages.
 *
 * Query-phase: {@link queryPlanner} (LLM subquery planning), {@link multiQuery}
 * (query expansion). Hit-phase: {@link parentExpand} (parent-record hydration),
 * {@link compress} (extractive compression), {@link diversify} (MMR), and
 * {@link decay} (recency scoring).
 *
 * @module
 */

import { z } from 'zod'
import type { GenerateObjectFn } from '../compaction/types'
import { isRecord } from './guards'
import { retrievalStage } from './stage'
import type { HitRetrievalStage, RetrieverHit } from './types'

export { parentExpand } from './parent-expand'
export { multiQuery, queryPlanner } from './query-stages'

/** Extract only query-relevant verbatim excerpts from each hit using an LLM. */
export function compress(config: {
  name?: string
  generate: GenerateObjectFn
  model: unknown
  mode?: 'extractive'
  maxCharsPerHit?: number
  keepEmpty?: boolean
  system?: string
}): HitRetrievalStage {
  if (config.mode && config.mode !== 'extractive') {
    throw new Error('compress() currently supports only mode: "extractive".')
  }
  const outputSchema = z.object({
    hits: z.array(
      z.object({
        sourceId: z.string(),
        chunkId: z.string(),
        excerpts: z.array(z.string()),
      }),
    ),
  })

  return retrievalStage({
    name: config.name ?? 'compress',
    phase: 'hits',
    kind: 'compress',
    async run({ query, hits }) {
      const result = await config.generate({
        model: config.model,
        system:
          config.system ??
          'Extract only query-relevant verbatim excerpts from retrieved chunks. Preserve sourceId and chunkId.',
        prompt: JSON.stringify({
          query,
          maxCharsPerHit: config.maxCharsPerHit ?? 1200,
          hits: hits.map((hitItem) => ({
            sourceId: hitItem.sourceId,
            chunkId: hitItem.chunkId,
            content: hitItem.content,
          })),
        }),
        schema: outputSchema,
      })
      const parsed = outputSchema.parse(result.object)
      const excerptsById = new Map(parsed.hits.map((item) => [sourceChunkIdentity(item), item.excerpts]))
      const compressed: RetrieverHit[] = []
      for (const hitItem of hits) {
        const excerpts = (excerptsById.get(sourceChunkIdentity(hitItem)) ?? [])
          .map((excerpt) => excerpt.trim())
          .filter(Boolean)
        if (excerpts.length === 0 && !config.keepEmpty) continue
        const content = excerpts.join('\n\n').slice(0, config.maxCharsPerHit ?? Number.MAX_SAFE_INTEGER)
        compressed.push({
          ...hitItem,
          content,
          metadata: {
            ...hitItem.metadata,
            _cruxCompression: {
              originalLength: hitItem.content.length,
              compressedLength: content.length,
            },
          },
        })
      }
      return compressed
    },
  })
}

/** Re-rank hits for diversity via Maximal Marginal Relevance (MMR). */
export function diversify(config: {
  name?: string
  strategy: 'mmr'
  lambda?: number
  limit?: number
  sourcePenalty?: number
}): HitRetrievalStage {
  const lambda = config.lambda ?? 0.5
  const sourcePenalty = config.sourcePenalty ?? 0
  return retrievalStage({
    name: config.name ?? 'diversify',
    phase: 'hits',
    kind: 'diversify',
    run({ hits }) {
      const remaining = [...hits]
      const selected: RetrieverHit[] = []
      const limit = config.limit ?? remaining.length

      while (remaining.length > 0 && selected.length < limit) {
        let bestIndex = 0
        let bestScore = Number.NEGATIVE_INFINITY
        for (let index = 0; index < remaining.length; index++) {
          const candidate = remaining[index]
          const similarityPenalty = selected.reduce(
            (max, item) => Math.max(max, contentSimilarity(candidate.content, item.content)),
            0,
          )
          const sourceDupPenalty = selected.some((item) => item.sourceId === candidate.sourceId) ? sourcePenalty : 0
          const mmrScore = lambda * candidate.score - (1 - lambda) * similarityPenalty - sourceDupPenalty
          if (mmrScore > bestScore) {
            bestIndex = index
            bestScore = mmrScore
          }
        }
        const [chosen] = remaining.splice(bestIndex, 1)
        selected.push({
          ...chosen,
          metadata: {
            ...chosen.metadata,
            _cruxDiversity: { strategy: config.strategy, mmrScore: bestScore },
          },
        })
      }
      return selected
    },
  })
}

/** Decay hit scores by the age of a numeric timestamp field. */
export function decay(config: {
  name?: string
  field: string
  halfLifeMs: number
  missing?: 'ignore' | 'penalize' | 'error'
}): HitRetrievalStage {
  const missing = config.missing ?? 'ignore'
  return retrievalStage({
    name: config.name ?? 'decay',
    phase: 'hits',
    kind: 'decay',
    run({ hits }) {
      const now = Date.now()
      return hits
        .map((hitItem) => {
          const raw = readPath(hitItem, config.field)
          if (typeof raw !== 'number' || !Number.isFinite(raw)) {
            if (missing === 'error') {
              throw new Error(`decay() could not read numeric timestamp at "${config.field}".`)
            }
            if (missing === 'penalize') {
              return annotateDecay(hitItem, config.field, 0.5, hitItem.score * 0.5)
            }
            return hitItem
          }
          const ageMs = Math.max(0, now - raw)
          const factor = Math.pow(0.5, ageMs / config.halfLifeMs)
          return annotateDecay(hitItem, config.field, factor, hitItem.score * factor)
        })
        .sort((a, b) => b.score - a.score)
    },
  })
}

function sourceChunkIdentity(hit: Pick<RetrieverHit, 'sourceId' | 'chunkId'>): string {
  return `${hit.sourceId}/${hit.chunkId}`
}

function contentSimilarity(a: string, b: string): number {
  const left = tokenSet(a)
  const right = tokenSet(b)
  if (left.size === 0 || right.size === 0) return 0
  let intersection = 0
  for (const token of left) {
    if (right.has(token)) intersection++
  }
  return intersection / new Set([...left, ...right]).size
}

function tokenSet(value: string): Set<string> {
  return new Set(value.toLowerCase().match(/[a-z0-9]+/g) ?? [])
}

function readPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!isRecord(current)) return undefined
    return current[segment]
  }, value)
}

function annotateDecay(hit: RetrieverHit, field: string, factor: number, score: number): RetrieverHit {
  return {
    ...hit,
    score,
    metadata: {
      ...hit.metadata,
      _cruxDecay: { field, factor },
    },
  }
}
