/**
 * Retrieval pipeline stage authoring.
 *
 * {@link retrievalStage} is the low-level constructor that the built-in stages
 * (`queryPlanner`, `multiQuery`, etc.) and custom stages use. Also exports the
 * planned-query normalizer and stage-name validator shared across the domain.
 *
 * @module
 */

import type {
  HitRetrievalStage,
  HitStageInput,
  HitStageResult,
  PlannedRetrievalQuery,
  QueryRetrievalStage,
  QueryStageInput,
  QueryStageResult,
  RetrievalPipelineStage,
  RetrievalStageKind,
  RetrievalStagePhase,
} from './types'

/** Define a query-phase retrieval stage. */
export function retrievalStage(config: {
  name: string
  phase: 'query'
  kind?: RetrievalStageKind
  run(input: QueryStageInput): Promise<QueryStageResult> | QueryStageResult
}): QueryRetrievalStage
/** Define a hit-phase retrieval stage. */
export function retrievalStage(config: {
  name: string
  phase: 'hits'
  kind?: RetrievalStageKind
  run(input: HitStageInput): Promise<HitStageResult> | HitStageResult
}): HitRetrievalStage
export function retrievalStage(config: {
  name: string
  phase: RetrievalStagePhase
  kind?: RetrievalStageKind
  run(
    input: QueryStageInput | HitStageInput,
  ): Promise<QueryStageResult | HitStageResult> | QueryStageResult | HitStageResult
}): RetrievalPipelineStage {
  validateStageName(config.name)
  return Object.freeze({
    _tag: 'RetrievalStage' as const,
    name: config.name,
    phase: config.phase,
    kind: config.kind ?? 'custom',
    run: config.run,
  } as RetrievalPipelineStage)
}

/** Throw if a stage name is empty or whitespace. */
export function validateStageName(name: string): void {
  if (!name.trim()) {
    throw new Error('Retrieval stage name must be non-empty.')
  }
}

/** Trim and validate a planned query, dropping empty optional fields. */
export function normalizePlannedQuery(query: PlannedRetrievalQuery): PlannedRetrievalQuery {
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
