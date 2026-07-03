/**
 * Runtime engine for named retrieval recipes.
 *
 * @module
 */

import { mapConcurrent } from '../../shared/concurrency'
import { observe } from '../../observability'
import { RetrievalRunError, retrievalNotImplemented } from '../errors'
import { emitRetrievalHitsArtifact } from '../observability'
import { normalizeRetrieveRequest, type RetrieveOptions, type RetrieveRequest } from '../request'
import type { Retriever, RetrieverHit } from '../types'
import { fuseQueryGroups, mergeRetrieveOptions } from './fusion'
import { getRetrieveStepConfig, type PlannedQuery, type RetrievalStep, type RetrievalStepContext } from './step'
import { countStepPayload, serializeRecipeError, type RecipeTrace, type StepTrace } from './trace'

let recipeRunCounter = 0

/** Normalized single-source recipe configuration used by the runner. */
export interface RecipeRunnerConfig {
  recipeId: string
  retrievers: readonly Retriever[]
  steps: readonly RetrievalStep[]
  model?: RetrievalStepContext['model']
  concurrency: number
}

/** Execute a recipe and return hits plus a serializable trace. */
export async function runRetrievalRecipe(
  config: RecipeRunnerConfig,
  queryOrRequest: string | RetrieveRequest,
  options: RetrieveOptions = {},
): Promise<{ hits: RetrieverHit[]; trace: RecipeTrace }> {
  const request = normalizeRetrieveRequest(queryOrRequest, options)
  const span = observe.openSpan({
    name: `${config.recipeId}.recipe`,
    family: 'retrieval',
    primitive: 'retrieval.recipe',
    attributes: {
      recipeId: config.recipeId,
      sourceRetrieverIds: config.retrievers.map((retriever) => retriever.id),
      namespaceCount: new Set(config.retrievers.map((retriever) => retriever.namespace)).size,
      stepCount: config.steps.length,
      query: request.query,
      ...(request.limit !== undefined ? { limit: request.limit } : {}),
      ...(request.threshold !== undefined ? { threshold: request.threshold } : {}),
      ...(request.filter ? { filter: request.filter } : {}),
      ...(request.mode ? { mode: request.mode } : {}),
      ...(request.fusion ? { fusion: request.fusion.strategy } : {}),
    },
  })
  try {
    return await span.withContext(() => runRetrievalRecipeInternal(config, request, span))
  } catch (error) {
    span.error(error)
    throw error
  }
}

async function runRetrievalRecipeInternal(
  config: RecipeRunnerConfig,
  request: RetrieveRequest,
  recipeSpan: ReturnType<typeof observe.openSpan>,
): Promise<{ hits: RetrieverHit[]; trace: RecipeTrace }> {
  const startedAt = Date.now()
  const traceId = `${startedAt}-retrieval-recipe-${++recipeRunCounter}`
  const steps: StepTrace[] = []
  const errors: ReturnType<typeof serializeRecipeError>[] = []

  let state: RecipeState = {
    phase: 'queries',
    queries: [normalizePlannedQuery({ query: request.query, filter: request.filter })],
  }

  try {
    for (const step of config.steps) {
      state = await runOneStep({
        config,
        request,
        state,
        step,
        traces: steps,
      })
    }

    const hits = state.phase === 'hits' ? [...state.hits] : []
    const trace = buildTrace({ config, traceId, startedAt, request, steps, resultCount: hits.length, errors })
    emitRetrievalHitsArtifact(recipeSpan.spanId, {
      retrievalId: trace.id,
      retrieverId: config.retrievers[0]?.id ?? '',
      recipeId: config.recipeId,
      namespace: config.retrievers[0]?.namespace ?? '',
      mode: 'recipe',
      query: request.query,
      limit: request.limit,
      fusion: request.fusion?.strategy,
      hits,
    })
    recipeSpan.end({
      recipeId: config.recipeId,
      resultCount: hits.length,
      durationMs: trace.durationMs,
    })
    return { hits, trace }
  } catch (error) {
    const serialized = serializeRecipeError(error)
    errors.push(serialized)
    throw new RetrievalRunError('step_failed', serialized.message, {
      cause: error,
      trace: buildTrace({ config, traceId, startedAt, request, steps, resultCount: 0, errors }),
    })
  }
}

type RecipeState =
  | { phase: 'queries'; queries: readonly PlannedQuery[] }
  | { phase: 'hits'; hits: readonly RetrieverHit[] }

function buildTrace(args: {
  config: RecipeRunnerConfig
  traceId: string
  startedAt: number
  request: RetrieveRequest
  steps: readonly StepTrace[]
  resultCount: number
  errors: readonly ReturnType<typeof serializeRecipeError>[]
}): RecipeTrace {
  return {
    id: args.traceId,
    recipeId: args.config.recipeId,
    retrieverId: args.config.retrievers[0]?.id ?? '',
    startedAt: args.startedAt,
    durationMs: Date.now() - args.startedAt,
    input: args.request,
    query: args.request.query,
    steps: args.steps,
    resultCount: args.resultCount,
    warnings: args.steps.flatMap((step) => step.warnings),
    errors: args.errors,
  }
}

async function runOneStep(args: {
  config: RecipeRunnerConfig
  request: RetrieveRequest
  state: RecipeState
  step: RetrievalStep
  traces: StepTrace[]
}): Promise<RecipeState> {
  const startedAt = Date.now()
  const inputCounts = countStepPayload(args.state)
  const span = observe.openSpan({
    name: `${args.state.phase}:${args.step.id}`,
    family: 'retrieval',
    primitive: 'retrieval.step',
    attributes: {
      recipeId: args.config.recipeId,
      stepId: args.step.id,
      kind: args.step.kind,
      status: 'running',
      ...(inputCounts.queryCount !== undefined ? { inputQueryCount: inputCounts.queryCount } : {}),
      ...(inputCounts.hitCount !== undefined ? { inputHitCount: inputCounts.hitCount } : {}),
    },
  })

  try {
    assertStepAcceptsState(args.step, args.state)
    const output = await span.withContext(() =>
      args.step.kind === 'retrieve'
        ? runRetrieveStep(args.config, args.request, args.state, args.step)
        : args.step.run(stepInput(args.state), {
            recipeId: args.config.recipeId,
            sources: args.config.retrievers.map((retriever) => ({
              retrieverId: retriever.id,
              namespace: retriever.namespace,
            })),
            originalQuery: args.request.query,
            request: args.request,
            model: args.step.model ?? args.config.model,
            concurrency: args.config.concurrency,
          }),
    )

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
    })
    span.end({
      status: 'success',
      ...(outputCounts.queryCount !== undefined ? { outputQueryCount: outputCounts.queryCount } : {}),
      ...(outputCounts.hitCount !== undefined ? { outputHitCount: outputCounts.hitCount } : {}),
      warningCount: output.warnings?.length ?? 0,
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

async function runRetrieveStep(
  config: RecipeRunnerConfig,
  request: RetrieveRequest,
  state: RecipeState,
  step: RetrievalStep,
): Promise<{ hits: readonly RetrieverHit[]; warnings?: readonly string[] }> {
  if (state.phase !== 'queries') {
    throw new Error(`Step "${step.id}" cannot retrieve from hit input.`)
  }
  if (config.retrievers.length !== 1) {
    return retrievalNotImplemented('phase 3b', 'federated retrievalRecipe retrieve step')
  }

  const stepConfig = getRetrieveStepConfig(step)
  const retriever = config.retrievers[0]
  const groups = await mapConcurrent(state.queries, config.concurrency, async (planned) => ({
    planned,
    hits: await retriever.retrieve(planned.query, mergeRetrieveOptions(request, planned, stepConfig)),
  }))

  return { hits: fuseQueryGroups(groups, request.fusion?.k) }
}

function stepInput(state: RecipeState): { queries: readonly PlannedQuery[] } | { hits: readonly RetrieverHit[] } {
  return state.phase === 'queries' ? { queries: state.queries } : { hits: state.hits }
}

function stepOutput(
  step: RetrievalStep,
  output: { queries?: readonly PlannedQuery[]; hits?: readonly RetrieverHit[] },
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
