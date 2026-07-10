/**
 * Federated retrieve-step execution for retrieval recipes.
 *
 * @module
 */

import { mapConcurrent } from '../../shared/concurrency'
import { RetrievalRunError } from '../errors'
import type { RetrieveRequest } from '../request'
import type { RetrieverHit } from '../types'
import { fuseQueryGroups, mergeRetrieveOptions } from './fusion'
import type { NormalizedRecipeSource } from './source'
import type { PlannedQuery, RetrievalSourceTrace } from './step'
import { serializeRecipeError } from './trace'

interface FederatedRetrieveConfig {
  sources: readonly NormalizedRecipeSource[]
  concurrency: number
  onSourceError: 'fail' | 'skip-with-warning'
}

interface RetrieveStepConfig {
  limit?: number
  threshold?: number
}

interface RetrieveTask {
  planned: PlannedQuery
  source: NormalizedRecipeSource
}

interface RetrieveGroup {
  planned: PlannedQuery
  source?: NormalizedRecipeSource
  hits: readonly RetrieverHit[]
}

interface SourceTraceAccumulator {
  retrieverId: string
  namespace: string
  weight: number
  status: RetrievalSourceTrace['status']
  durationMs: number
  queryCount: number
  hitCount: number
  warnings: string[]
  error?: NonNullable<RetrievalSourceTrace['error']>
}

/** Run all planned query/source pairs and return fused hits plus source traces. */
export async function runFederatedRetrieveStep(
  config: FederatedRetrieveConfig,
  request: RetrieveRequest,
  queries: readonly PlannedQuery[],
  stepConfig: RetrieveStepConfig | undefined,
): Promise<{ hits: readonly RetrieverHit[]; warnings?: readonly string[]; sources?: readonly RetrievalSourceTrace[] }> {
  const tasks = queries.flatMap((planned) => config.sources.map((source) => ({ planned, source })))
  const traces = new SourceTraceBuilder(config.sources)
  const warnings: string[] = []
  const groups = await mapConcurrent(tasks, config.concurrency, async (task) =>
    retrieveTask({ task, config, request, stepConfig, traces, warnings }),
  )

  return {
    hits: fuseQueryGroups(groups, request.fusion?.k),
    ...(warnings.length ? { warnings } : {}),
    sources: traces.toTrace(),
  }
}

async function retrieveTask(args: {
  task: RetrieveTask
  config: FederatedRetrieveConfig
  request: RetrieveRequest
  stepConfig: RetrieveStepConfig | undefined
  traces: SourceTraceBuilder
  warnings: string[]
}): Promise<RetrieveGroup> {
  const startedAt = Date.now()
  try {
    const hits = await args.task.source.retriever.retrieve(
      args.task.planned.query,
      mergeRetrieveOptions(args.request, args.task.planned, args.stepConfig),
    )
    args.traces.recordSuccess(args.task.source, Date.now() - startedAt, hits.length)
    const group = {
      planned: args.task.planned,
      hits,
    }
    return args.config.sources.length > 1 ? { ...group, source: args.task.source } : group
  } catch (error) {
    const serialized = serializeRecipeError(error)
    args.traces.recordError(args.task.source, Date.now() - startedAt, serialized)
    if (args.config.onSourceError === 'fail') {
      throw new RetrievalRunError('source_failed', `Retrieval source "${args.task.source.retriever.id}" failed.`, {
        cause: error,
      })
    }
    args.warnings.push(`Retrieval source "${args.task.source.retriever.id}" failed and was skipped: ${serialized.message}`)
    const group = {
      planned: args.task.planned,
      hits: [],
    }
    return args.config.sources.length > 1 ? { ...group, source: args.task.source } : group
  }
}

class SourceTraceBuilder {
  private readonly traces = new Map<string, SourceTraceAccumulator>()

  constructor(sources: readonly NormalizedRecipeSource[]) {
    for (const source of sources) {
      this.traces.set(source.retriever.id, {
        retrieverId: source.retriever.id,
        namespace: source.retriever.namespace,
        weight: source.weight,
        status: 'success',
        durationMs: 0,
        queryCount: 0,
        hitCount: 0,
        warnings: [],
      })
    }
  }

  recordSuccess(source: NormalizedRecipeSource, durationMs: number, hitCount: number): void {
    const trace = this.requireTrace(source)
    trace.durationMs += durationMs
    trace.queryCount += 1
    trace.hitCount += hitCount
  }

  recordError(source: NormalizedRecipeSource, durationMs: number, error: NonNullable<RetrievalSourceTrace['error']>): void {
    const trace = this.requireTrace(source)
    trace.status = 'skipped'
    trace.durationMs += durationMs
    trace.queryCount += 1
    trace.error = error
    trace.warnings.push(error.message)
  }

  toTrace(): RetrievalSourceTrace[] {
    return [...this.traces.values()].map((trace) => ({
      retrieverId: trace.retrieverId,
      namespace: trace.namespace,
      status: trace.status,
      durationMs: trace.durationMs,
      queryCount: trace.queryCount,
      hitCount: trace.hitCount,
      weight: trace.weight,
      warnings: trace.warnings,
      ...(trace.error ? { error: trace.error } : {}),
    }))
  }

  private requireTrace(source: NormalizedRecipeSource): SourceTraceAccumulator {
    const trace = this.traces.get(source.retriever.id)
    if (!trace) {
      throw new Error(`Unknown retrieval source "${source.retriever.id}".`)
    }
    return trace
  }
}
