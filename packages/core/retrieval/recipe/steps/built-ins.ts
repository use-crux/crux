/**
 * Built-in retrieval recipe steps.
 *
 * These helpers compile common RAG operations into typed `RetrievalStep`
 * instances while the core step authoring module stays small.
 *
 * @module
 */

import { z } from 'zod'
import { createIndexedKnowledgeStore } from '../../../indexed-knowledge'
import { mapConcurrent } from '../../../shared/concurrency'
import type { RecordStore } from '../../../storage'
import type { RetrievalModel } from '../../model'
import { judgeReranker, type Reranker } from '../../reranker'
import type { RetrieverHit } from '../../types'
import {
  markBuiltInRetrievalStep,
  retrievalStep,
  setRetrieveStepConfig,
  type PlannedQuery,
  type RetrievalStep,
} from '../step'

/** Create a query rewrite step. */
export function rewriteQuery(config: { id?: string; model?: RetrievalModel } = {}): RetrievalStep<'queries', 'queries'> {
  return markBuiltInRetrievalStep(
    retrievalStep({
      id: config.id ?? 'rewrite-query',
      kind: 'rewrite-query',
      phase: { in: 'queries', out: 'queries' },
      model: config.model,
      needsModel: true,
      run: (input) => input,
    }),
  )
}

/** Create a model-backed query fanout step. */
export function fanout(
  config: { id?: string; maxQueries?: number; model?: RetrievalModel } = {},
): RetrievalStep<'queries', 'queries'> {
  const maxQueries = config.maxQueries ?? 4
  return markBuiltInRetrievalStep(
    retrievalStep({
      id: config.id ?? 'fanout',
      kind: 'fanout',
      phase: { in: 'queries', out: 'queries' },
      model: config.model,
      needsModel: true,
      async run(input, context) {
        const model = requireStepModel(config.id ?? 'fanout', context.model)
        const expandedGroups = await mapConcurrent(input.queries, context.concurrency, async (planned) => {
          const result = await model.generateText({
            system:
              'Generate alternate retrieval queries. Return one query per line. Do not number the lines and do not answer.',
            prompt: `Original query:\n${planned.query}\n\nGenerate ${Math.max(0, maxQueries - 1)} alternate retrieval queries.`,
          })
          return [
            planned,
            ...parseGeneratedQueries(result.text, Math.max(0, maxQueries - 1)).map((query) => ({
              ...planned,
              query,
            })),
          ]
        })
        return { queries: dedupePlannedQueries(expandedGroups.flat()).slice(0, maxQueries) }
      },
    }),
  )
}

/** Create the built-in step that executes the recipe retriever. */
export function retrieve(config: { id?: string; limit?: number } = {}): RetrievalStep<'queries', 'hits'> {
  const step = markBuiltInRetrievalStep(
    retrievalStep({
      id: config.id ?? 'retrieve',
      kind: 'retrieve',
      phase: { in: 'queries', out: 'hits' },
      run: () => ({ hits: [] }),
    }),
  )
  setRetrieveStepConfig(step, {
    ...(config.limit !== undefined ? { limit: config.limit } : {}),
  })
  return step
}

/** Create a rerank step backed by an explicit engine or the recipe model. */
export function rerank(
  config: { id?: string; topK?: number; model?: RetrievalModel; engine?: Reranker } = {},
): RetrievalStep<'hits', 'hits'> {
  return markBuiltInRetrievalStep(
    retrievalStep({
      id: config.id ?? 'rerank',
      kind: 'rerank',
      phase: { in: 'hits', out: 'hits' },
      model: config.model,
      needsModel: !config.engine,
      async run(input, context) {
        const engine =
          config.engine ??
          judgeReranker({
            model: requireStepModel(config.id ?? 'rerank', context.model),
          })
        const reranked = await engine.rerank({
          query: context.originalQuery,
          hits: input.hits,
        })
        const hits = config.engine ? reranked.map(withRerankProvenance) : reranked
        return { hits: hits.slice(0, config.topK ?? hits.length) }
      },
    }),
  )
}

/** Create a parent-record hydration step. */
export function expandParents(config: {
  id?: string
  records?: RecordStore
  indexerId?: string
  maxParentChars?: number
  missing?: 'ignore' | 'warn' | 'error'
} = {}): RetrievalStep<'hits', 'hits'> {
  return markBuiltInRetrievalStep(
    retrievalStep({
      id: config.id ?? 'expand-parents',
      kind: 'expand-parents',
      phase: { in: 'hits', out: 'hits' },
      async run(input, context) {
        if (!config.records) return input
        const warnings: string[] = []
        const stores = new Map<string, ReturnType<typeof createIndexedKnowledgeStore>>()
        const expanded: RetrieverHit[] = []
        for (const hit of input.hits) {
          const indexerId = config.indexerId ?? context.sources[0]?.retrieverId ?? context.recipeId
          const storeKey = `${indexerId}:${hit.namespace}`
          const store =
            stores.get(storeKey) ??
            createIndexedKnowledgeStore({
              indexerId,
              namespace: hit.namespace,
              records: config.records,
            })
          stores.set(storeKey, store)
          const next = await store.expandParent(hit, {
            maxParentChars: config.maxParentChars,
            missing: config.missing,
          })
          if (next === hit && (hit.parent?.key || hit.parent?.parentId) && config.missing === 'warn') {
            warnings.push(`parentExpand could not find parent record "${hit.parent.key ?? hit.parent.parentId}".`)
          }
          expanded.push(next)
        }
        return { hits: expanded, warnings }
      },
    }),
  )
}

/** Create a model-backed context compression step. */
export function compressToBudget(
  config: { id?: string; tokens: number; model?: RetrievalModel; maxCharsPerHit?: number; keepEmpty?: boolean },
): RetrievalStep<'hits', 'hits'> {
  const maxCharsPerHit = config.maxCharsPerHit ?? 1200
  return markBuiltInRetrievalStep(
    retrievalStep({
      id: config.id ?? 'compress',
      kind: 'compress',
      phase: { in: 'hits', out: 'hits' },
      model: config.model,
      needsModel: true,
      async run(input, context) {
        const model = requireStepModel(config.id ?? 'compress', context.model)
        const outputSchema = z.object({
          hits: z.array(
            z.object({
              sourceId: z.string(),
              chunkId: z.string(),
              excerpts: z.array(z.string()),
            }),
          ),
        })
        const result = await model.generateObject({
          system:
            'Extract only query-relevant verbatim excerpts from retrieved chunks. Preserve sourceId and chunkId.',
          prompt: JSON.stringify({
            query: context.originalQuery,
            tokenBudget: config.tokens,
            maxCharsPerHit,
            hits: input.hits.map((hit) => ({
              sourceId: hit.sourceId,
              chunkId: hit.chunkId,
              content: hit.content,
            })),
          }),
          schema: outputSchema,
        })
        const excerptsById = new Map(result.object.hits.map((item) => [sourceChunkIdentity(item), item.excerpts]))
        const compressed: RetrieverHit[] = []
        for (const hit of input.hits) {
          const excerpts = (excerptsById.get(sourceChunkIdentity(hit)) ?? [])
            .map((excerpt) => excerpt.trim())
            .filter(Boolean)
          if (excerpts.length === 0 && !config.keepEmpty) continue
          const content = excerpts.join('\n\n').slice(0, maxCharsPerHit)
          compressed.push({
            ...hit,
            content,
            provenance: {
              ...hit.provenance,
              compression: {
                originalLength: hit.content.length,
                compressedLength: content.length,
              },
            },
          })
        }
        return { hits: compressed }
      },
    }),
  )
}

function requireStepModel(stepId: string, model: RetrievalModel | undefined): RetrievalModel {
  if (!model) {
    throw new Error(`Retrieval step "${stepId}" requires a model.`)
  }
  return model
}

function parseGeneratedQueries(text: string, count: number): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*\d.)]+\s*/, '').trim())
    .filter(Boolean)
    .slice(0, count)
}

function dedupePlannedQueries(queries: readonly PlannedQuery[]): PlannedQuery[] {
  const seen = new Set<string>()
  const deduped: PlannedQuery[] = []
  for (const query of queries) {
    const normalized = normalizePlannedQuery(query)
    const key = JSON.stringify({ query: normalized.query, filter: normalized.filter ?? {} })
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(normalized)
  }
  return deduped
}

function normalizePlannedQuery(query: PlannedQuery): PlannedQuery {
  const trimmed = query.query.trim()
  if (!trimmed) throw new Error('Planned retrieval query must be non-empty.')
  if (query.weight !== undefined && query.weight <= 0) {
    throw new Error('Planned retrieval query weight must be positive.')
  }
  return {
    query: trimmed,
    ...(query.filter ? { filter: query.filter } : {}),
    ...(query.weight !== undefined ? { weight: query.weight } : {}),
    ...(query.reason ? { reason: query.reason } : {}),
  }
}

function withRerankProvenance(hit: RetrieverHit): RetrieverHit {
  return {
    ...hit,
    provenance: {
      ...hit.provenance,
      rerankScore: hit.provenance?.rerankScore ?? hit.score,
    },
  }
}

function sourceChunkIdentity(hit: Pick<RetrieverHit, 'sourceId' | 'chunkId'>): string {
  return `${hit.sourceId}/${hit.chunkId}`
}
