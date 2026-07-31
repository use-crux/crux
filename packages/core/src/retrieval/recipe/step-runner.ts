/** Execution and tracing for one retrieval recipe step. @module */

import { observe } from '../../observability'
import { recipeStepDefinitionRef, rerankerDefinitionRef } from '../../observability/definition-ref'
import { matchesExactFilter, type JsonObject } from '../../storage'
import type { RetrieveRequest } from '../request'
import type { EvidenceHit, RetrieverHit } from '../types'
import { runFederatedRetrieveStep } from './federation'
import type { RetrievalKnowledgeBinding } from './knowledge-binding'
import type { RecipeRunnerConfig } from './run'
import {
  getRerankerDefinitionId,
  getRetrieveStepConfig,
  type PlannedQuery,
  type RetrievalStep,
  type StepOutput,
  type StepPhase,
} from './step'
import { countStepPayload, serializeRecipeError, type StepTrace } from './trace'

/** Runtime state passed between recipe steps. */
export type RecipeState =
  | { phase: 'queries'; queries: readonly PlannedQuery[] }
  | { phase: 'hits'; hits: readonly import('../types').RetrieverHit[] }

/** Execute one recipe step and append its trace result. */
export async function runRecipeStep(args: {
  config: RecipeRunnerConfig
  request: RetrieveRequest
  safeRequest: RetrieveRequest
  queryLabel: string
  state: RecipeState
  step: RetrievalStep
  traces: StepTrace[]
}): Promise<RecipeState> {
  const startedAt = Date.now()
  const inputCounts = countStepPayload(args.state)
  const rerankerId = getRerankerDefinitionId(args.step)
  const knowledge = stepKnowledge(args.config.knowledge, args.safeRequest)
  const definitionRefs = [
    recipeStepDefinitionRef(args.config.recipeId, args.step.id),
    ...(rerankerId ? [rerankerDefinitionRef(rerankerId)] : []),
  ]
  const span = observe.openSpan({
    name: `${args.state.phase}:${args.step.id}`,
    primitive: 'retrieval.step',
    definitionRefs,
    attributes: {
      recipeId: args.config.recipeId,
      stepId: args.step.id,
      stepKind: args.step.kind,
      kind: args.step.kind,
      status: 'running',
      ...(inputCounts.queryCount !== undefined ? { inputQueryCount: inputCounts.queryCount } : {}),
      ...(inputCounts.hitCount !== undefined ? { inputHitCount: inputCounts.hitCount } : {}),
    },
  })

  try {
    assertStepAcceptsState(args.step, args.state)
    const output = await span.withContext(async (): Promise<StepOutput<StepPhase>> => {
      if (args.step.kind === 'retrieve') {
        return runRetrieveStep(args.config, args.request, args.state, args.step)
      }
      return args.step.run(stepInput(args.state), {
            recipeId: args.config.recipeId,
            sources: args.config.sources.map((source) => ({
              retrieverId: source.retriever.id,
              namespace: source.retriever.namespace,
              weight: source.weight,
            })),
            originalQuery: args.queryLabel,
            request: args.safeRequest,
            model: args.step.model ?? args.config.model,
            concurrency: args.config.concurrency,
            ...(knowledge ? { knowledge } : {}),
            ...(args.config.communities ? { communities: args.config.communities } : {}),
          }) as StepOutput<StepPhase> | Promise<StepOutput<StepPhase>>
    })

    const outputCounts = countStepPayload(output)
    args.traces.push({
      stepId: args.step.id,
      kind: args.step.kind,
      status: 'success',
      durationMs: Date.now() - startedAt,
      ...(inputCounts.queryCount !== undefined ? { inputQueryCount: inputCounts.queryCount } : {}),
      ...(inputCounts.hitCount !== undefined ? { inputHitCount: inputCounts.hitCount } : {}),
      ...(outputCounts.queryCount !== undefined ? { outputQueryCount: outputCounts.queryCount } : {}),
      ...(outputCounts.hitCount !== undefined ? { outputHitCount: outputCounts.hitCount } : {}),
      warnings: output.warnings ?? [],
      ...(output.sources ? { sources: output.sources } : {}),
      ...(output.knowledge ? { knowledge: output.knowledge } : {}),
    })
    span.end({
      status: 'ok',
      attributes: {
        ...(outputCounts.queryCount !== undefined ? { outputQueryCount: outputCounts.queryCount } : {}),
        ...(outputCounts.hitCount !== undefined ? { outputHitCount: outputCounts.hitCount } : {}),
        warningCount: output.warnings?.length ?? 0,
      },
    })
    return stepOutput(args.step, output)
  } catch (error) {
    args.traces.push({
      stepId: args.step.id,
      kind: args.step.kind,
      status: 'error',
      durationMs: Date.now() - startedAt,
      ...(inputCounts.queryCount !== undefined ? { inputQueryCount: inputCounts.queryCount } : {}),
      ...(inputCounts.hitCount !== undefined ? { inputHitCount: inputCounts.hitCount } : {}),
      warnings: [],
      error: serializeRecipeError(error),
    })
    span.error(error, { status: 'error', warningCount: 0 })
    throw error
  }
}

/** Normalize and validate one planned text query. */
export function normalizePlannedQuery(query: PlannedQuery): PlannedQuery {
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

async function runRetrieveStep(
  config: RecipeRunnerConfig,
  request: RetrieveRequest,
  state: RecipeState,
  step: RetrievalStep,
) {
  if (state.phase !== 'queries') {
    throw new Error(`Step "${step.id}" cannot retrieve from hit input.`)
  }
  return runFederatedRetrieveStep(config, request, state.queries, getRetrieveStepConfig(step))
}

function stepKnowledge(
  binding: RetrievalKnowledgeBinding | undefined,
  request: RetrieveRequest,
): RetrievalKnowledgeBinding | undefined {
  const filter = request.filter
  if (!binding || !filter) return binding
  return {
    ...binding,
    hydrate: async (ref) => {
      const hit = await binding.hydrate(ref)
      return hit && hit.kind !== 'finding' && matchesExactFilter(hitVisibility(hit), filter) ? hit : null
    },
  }
}

function stepInput(state: RecipeState) {
  return state.phase === 'queries' ? { queries: state.queries } : { hits: state.hits }
}

function hitVisibility(hit: EvidenceHit): JsonObject {
  return {
    ...scalarMetadata(hit.metadata),
    namespace: hit.namespace,
    sourceId: hit.source.id,
    chunkId: hit.chunkId,
    _cruxRecordType: 'chunk',
    active: true,
  }
}

function scalarMetadata(metadata: Record<string, unknown>): JsonObject {
  const result: { [key: string]: JsonObject[string] } = {}
  for (const [key, value] of Object.entries(metadata)) {
    if (isFilterableJson(value)) result[key] = value
  }
  return result
}

function isFilterableJson(value: unknown): value is JsonObject[string] {
  return (
    value === null ||
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value)) ||
    typeof value === 'boolean'
  )
}

function stepOutput(
  step: RetrievalStep,
  output: { queries?: readonly PlannedQuery[]; hits?: readonly import('../types').RetrieverHit[] },
): RecipeState {
  if (step.phase.out === 'queries') {
    if (!output.queries || output.queries.length === 0) {
      throw new Error(`Retrieval step "${step.id}" returned no planned queries.`)
    }
    return { phase: 'queries', queries: output.queries.map(normalizePlannedQuery) }
  }
  return { phase: 'hits', hits: [...(output.hits ?? [])] }
}

function assertStepAcceptsState(step: RetrievalStep, state: RecipeState): void {
  if (step.phase.in !== state.phase) {
    throw new Error(`Retrieval step "${step.id}" expects ${step.phase.in} input but received ${state.phase}.`)
  }
}
