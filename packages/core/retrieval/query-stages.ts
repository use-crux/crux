/**
 * Built-in query-phase retrieval stages.
 *
 * These stages transform the user's query before hitting a retriever.
 *
 * @module
 */

import { z } from 'zod'
import type { GenerateObjectFn, GenerateTextFn } from '../compaction/types'
import { normalizePlannedQuery, retrievalStage } from './stage'
import type { PlannedRetrievalQuery, QueryRetrievalStage } from './types'

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
