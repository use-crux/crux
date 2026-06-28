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
import type { GenerateObjectFn, GenerateTextFn } from '../compaction/types'
import type { DataStore } from '../store/types'
import { isRecord } from './guards'
import { normalizePlannedQuery, retrievalStage } from './stage'
import type { HitRetrievalStage, PlannedRetrievalQuery, QueryRetrievalStage, RetrieverHit } from './types'

/** Plan focused retrieval subqueries from the user query using an LLM. */
export function queryPlanner<
  TFilter extends z.ZodType<Record<string, unknown>> = z.ZodType<Record<string, unknown>>,
>(config: {
  name?: string
  generate: GenerateObjectFn
  model: unknown
  maxQueries?: number
  filterSchema?: TFilter
  system?: string
}): QueryRetrievalStage {
  const maxQueries = config.maxQueries ?? 4
  const filterSchema = config.filterSchema ?? z.record(z.string(), z.unknown())
  const plannedQuerySchema = z.object({
    query: z.string().trim().min(1),
    filter: filterSchema.optional(),
    weight: z.number().positive().optional(),
    reason: z.string().trim().min(1).optional(),
  })
  const outputSchema = z.object({
    queries: z.array(plannedQuerySchema).min(1).max(maxQueries),
  })

  return retrievalStage({
    name: config.name ?? 'query-planner',
    phase: 'query',
    kind: 'query-planner',
    async run({ query }) {
      const result = await config.generate({
        model: config.model,
        system:
          config.system ??
          'Plan retrieval subqueries. Return focused search queries and optional metadata filters. Do not answer the user.',
        prompt: `User query:\n${query}\n\nReturn at most ${maxQueries} retrieval queries.`,
        schema: outputSchema,
      })
      const parsed = outputSchema.safeParse(result.object)
      if (!parsed.success) {
        throw new Error(`queryPlanner returned invalid planned queries: ${parsed.error.message}`)
      }
      return parsed.data.queries.map(normalizePlannedQuery)
    },
  })
}

/** Expand each planned query into alternate phrasings using an LLM. */
export function multiQuery(config: {
  name?: string
  generate: GenerateTextFn
  model: unknown
  count?: number
  includeOriginal?: boolean
  system?: string
}): QueryRetrievalStage {
  const count = config.count ?? 4
  const includeOriginal = config.includeOriginal ?? true
  return retrievalStage({
    name: config.name ?? 'multi-query',
    phase: 'query',
    kind: 'multi-query',
    async run({ queries }) {
      const expanded: PlannedRetrievalQuery[] = []
      for (const planned of queries) {
        if (includeOriginal) expanded.push(planned)
        const result = await config.generate({
          model: config.model,
          system:
            config.system ??
            'Generate alternate retrieval queries. Return one query per line. Do not number the lines and do not answer.',
          prompt: `Original query:\n${planned.query}\n\nGenerate ${count} alternate retrieval queries.`,
        })
        for (const generated of parseGeneratedQueries(result.text, count)) {
          expanded.push({
            ...planned,
            query: generated,
          })
        }
      }
      return dedupePlannedQueries(expanded)
    },
  })
}

/** Hydrate each hit with its parent record's content/metadata. */
export function parentExpand(config: {
  store: DataStore
  indexerId?: string
  maxParentChars?: number
  missing?: 'ignore' | 'warn' | 'error'
}): HitRetrievalStage {
  const missing = config.missing ?? 'warn'
  return retrievalStage({
    name: 'parent-expand',
    phase: 'hits',
    kind: 'parent-expand',
    async run({ hits, retrieverId }) {
      const warnings: string[] = []
      const expanded: RetrieverHit[] = []
      for (const hit of hits) {
        const parentKeyValue = hit.parent?.key ?? deriveParentKey(config.indexerId ?? retrieverId, hit)
        if (!parentKeyValue) {
          expanded.push(hit)
          continue
        }

        const parentRecord = await config.store.get(parentKeyValue)
        if (!parentRecord) {
          const warning = `parentExpand could not find parent record "${parentKeyValue}" for ${hit.sourceId}/${hit.chunkId}.`
          if (missing === 'error') throw new Error(warning)
          if (missing === 'warn') warnings.push(warning)
          expanded.push(hit)
          continue
        }

        const parentContent = typeof parentRecord.content === 'string' ? parentRecord.content : undefined
        const truncatedContent =
          parentContent && config.maxParentChars !== undefined
            ? parentContent.slice(0, config.maxParentChars)
            : parentContent
        expanded.push({
          ...hit,
          parent: {
            ...(hit.parent ?? {}),
            ...(typeof parentRecord.parentId === 'string' ? { parentId: parentRecord.parentId } : {}),
            key: parentKeyValue,
            ...(typeof parentRecord.content === 'string' ? { content: truncatedContent } : {}),
            ...(isRecord(parentRecord.metadata) ? { metadata: parentRecord.metadata } : {}),
          },
        })
      }
      return { hits: expanded, warnings }
    },
  })
}

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

function parseGeneratedQueries(text: string, count: number): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*\d.)]+\s*/, '').trim())
    .filter(Boolean)
    .slice(0, count)
}

function dedupePlannedQueries(queries: PlannedRetrievalQuery[]): PlannedRetrievalQuery[] {
  const seen = new Set<string>()
  const deduped: PlannedRetrievalQuery[] = []
  for (const query of queries) {
    const normalized = normalizePlannedQuery(query)
    const key = JSON.stringify({ query: normalized.query, filter: normalized.filter ?? {} })
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(normalized)
  }
  return deduped
}

function sourceChunkIdentity(hit: Pick<RetrieverHit, 'sourceId' | 'chunkId'>): string {
  return `${hit.sourceId}/${hit.chunkId}`
}

function deriveParentKey(indexerId: string, hit: RetrieverHit): string | undefined {
  if (!hit.parent?.parentId) return undefined
  return `indexer:${indexerId}:namespace:${hit.namespace}:source:${hit.sourceId}:parent:${hit.parent.parentId}`
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
