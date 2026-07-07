/**
 * The live cost tracker and its budget-limit error.
 *
 * {@link withCostTracking} returns a {@link CostTracker} that records actual or
 * estimated cost for each generation (via a runtime middleware + execution
 * hook), emits observability spans/events, enforces warn/limit budgets, and
 * exposes aggregated reports. {@link CostLimitError} is thrown when a hard
 * budget limit is reached.
 *
 * @module
 */

import { observe } from '../observability'
import { getHooks } from '../runtime/runtime'
import { getExecutionContext } from '../runtime/execution-context'
import type { PromptMiddlewareArgs } from '../runtime/types'
import type { TokenUsage, TraceMeta } from '../generation/types'
import type { CostEntry, CostReport, CostTracker, CostTrackingOptions } from './types'
import { buildReport, costEntryAttributes } from './report'

/** Thrown when a cost-tracking session reaches its configured hard `limit`. */
export class CostLimitError extends Error {
  readonly report: CostReport
  readonly limit: number
  readonly actual: number

  constructor(report: CostReport, limit: number) {
    super(`Crux cost limit exceeded: $${report.total.cost.toFixed(6)} >= $${limit.toFixed(6)}`)
    this.name = 'CostLimitError'
    this.report = report
    this.limit = limit
    this.actual = report.total.cost
  }
}

/**
 * Create a {@link CostTracker} that records and aggregates generation cost.
 *
 * Install the returned tracker as a plugin (`tracker.asPlugin()`); it hooks the
 * runtime middleware + execution pipeline to record each call's actual cost, or
 * estimate it from `options.pricing`. Budget thresholds emit `cost:warn` and
 * throw {@link CostLimitError} on `cost:limit`.
 *
 * @param options - Optional pricing table and budget thresholds.
 * @returns A cost tracker with `asPlugin()`, `getReport()`, and `reset()`.
 *
 * @example
 * ```ts
 * const tracker = withCostTracking({
 *   pricing: modelPricing({ 'gpt-4o': { input: 2.5, output: 10 } }),
 *   budget: { warn: 1, limit: 5 },
 * })
 * config({ plugins: [tracker.asPlugin()] })
 * // ... later
 * tracker.getReport().total.cost
 * ```
 */
export function withCostTracking(options: CostTrackingOptions = {}): CostTracker {
  const entries: CostEntry[] = []
  const recordedKeys = new Set<string>()
  let warned = false
  let limited = false

  function record(input: {
    promptId?: string
    model?: string
    provider?: string
    usage?: TokenUsage
    cost?: number
    traceId?: string
    agentId?: string
  }): CostEntry | undefined {
    const usage = input.usage
    const actualCost = typeof input.cost === 'number' && Number.isFinite(input.cost) ? input.cost : undefined
    const estimatedCost =
      actualCost === undefined && usage && input.model ? options.pricing?.estimate(input.model, usage) : undefined
    const cost = actualCost ?? estimatedCost
    if (cost === undefined) return undefined

    const trace = getExecutionContext()
    const key =
      input.traceId ??
      trace?.traceId ??
      `${input.promptId ?? 'unknown'}:${input.model ?? 'unknown'}:${entries.length}:${Date.now()}`
    if (recordedKeys.has(key)) return undefined
    recordedKeys.add(key)

    const entry: CostEntry = {
      id: key,
      timestamp: Date.now(),
      source: actualCost === undefined ? 'estimated' : 'actual',
      cost,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      totalTokens: usage?.totalTokens ?? (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0),
      cacheReadTokens: usage?.cacheReadTokens ?? 0,
      cacheWriteTokens: usage?.cacheWriteTokens ?? 0,
      reasoningTokens: usage?.reasoningTokens ?? 0,
      calls: 1,
      promptId: input.promptId,
      model: input.model,
      provider: input.provider,
      traceId: input.traceId ?? trace?.traceId,
      sessionId: trace?.sessionId,
      flowId: trace?.flowId,
      stepId: trace?.stepId,
      stepLabel: trace?.stepLabel,
      agentId: input.agentId,
    }

    entries.push(entry)
    emitCostRecord(entry)
    return entry
  }

  function emitCostRecord(entry: CostEntry): void {
    const report = buildReport(entries)
    const span = observe.openSpan({
      name: 'cost.record',
      primitive: 'cost.record',
      attributes: {
        ...costEntryAttributes(entry),
        totalCost: report.total.cost,
        totalCalls: report.total.calls,
      },
    })

    span.withContext(() => {
      observe.event({
        name: 'cost.recorded',
        attributes: {
          ...costEntryAttributes(entry),
          totalCost: report.total.cost,
          totalCalls: report.total.calls,
        },
      })
    })

    let warning = false

    const warn = options.budget?.warn
    if (warn !== undefined && !warned && report.total.cost >= warn) {
      warned = true
      warning = true
      options.budget?.onWarn?.(report)
      span.withContext(() => {
        observe.event({
          name: 'cost.warn',
          attributes: {
            threshold: warn,
            actual: report.total.cost,
            entryId: entry.id,
            cost: entry.cost,
          },
        })
      })
    }

    const limit = options.budget?.limit
    if (limit !== undefined && !limited && report.total.cost >= limit) {
      limited = true
      options.budget?.onLimit?.(report)
      const error = new CostLimitError(report, limit)
      span.withContext(() => {
        observe.event({
          name: 'cost.limit',
          attributes: {
            threshold: limit,
            actual: report.total.cost,
            entryId: entry.id,
            cost: entry.cost,
          },
        })
      })
      span.error(error, {
        ...costEntryAttributes(entry),
        totalCost: report.total.cost,
        totalCalls: report.total.calls,
        warning,
        limited: true,
        limit,
      })
      throw error
    }

    span.end({
      attributes: {
        ...costEntryAttributes(entry),
        totalCost: report.total.cost,
        totalCalls: report.total.calls,
        warning,
        limited: false,
      },
    })
  }

  const tracker: CostTracker = {
    _tag: 'CostTracker',
    asPlugin() {
      return {
        name: 'crux-cost-tracking',
        install() {
          return {
            middleware: async (args, next) => {
              const result = await next(args)
              const meta = getResultMeta(result)
              recordFromMeta(args, meta)
              void recordStreamCompletion(args, meta)
              return result
            },
            executionHook(args) {
              record({
                promptId: args.promptId,
                model: args.modelId ?? args.model,
                provider: args.provider,
                usage: args.usage,
                cost: args.cost,
                traceId: args.traceId,
              })
            },
          }
        },
      }
    },
    getReport() {
      return buildReport(entries)
    },
    reset(sessionId?: string) {
      if (!sessionId) {
        entries.splice(0, entries.length)
        recordedKeys.clear()
      } else {
        for (let i = entries.length - 1; i >= 0; i--) {
          if (entries[i].sessionId === sessionId) {
            recordedKeys.delete(entries[i].id)
            entries.splice(i, 1)
          }
        }
      }
      warned = false
      limited = false
    },
  }

  return tracker

  function recordFromMeta(args: PromptMiddlewareArgs, meta: TraceMeta | undefined): void {
    record({
      promptId: args.promptId,
      model: extractModelId(args.model ?? args.preparedArgs?.model),
      provider: args.provider,
      usage: meta?.usage,
      cost: meta?.cost,
    })
  }

  async function recordStreamCompletion(args: PromptMiddlewareArgs, meta: TraceMeta | undefined): Promise<void> {
    const completion = (meta as { _streamCompletion?: unknown } | undefined)?._streamCompletion
    if (!completion || typeof (completion as PromiseLike<unknown>).then !== 'function') return
    const streamMeta = (await (completion as Promise<TraceMeta | undefined>)) as TraceMeta | undefined
    recordFromMeta(args, streamMeta)
  }
}

/** Extract the normalized `_meta` (with optional stream completion) from a result. */
function getResultMeta(
  result: unknown,
): (TraceMeta & { _streamCompletion?: Promise<TraceMeta | undefined> }) | undefined {
  if (result && typeof result === 'object' && '_meta' in result) {
    return (result as { _meta?: TraceMeta & { _streamCompletion?: Promise<TraceMeta | undefined> } })._meta
  }
  return undefined
}

/** Best-effort extraction of a model id string from a model value of unknown shape. */
function extractModelId(model: unknown): string | undefined {
  if (typeof model === 'string') return model
  if (model && typeof model === 'object') {
    const record = model as Record<string, unknown>
    if (typeof record.modelId === 'string') return record.modelId
    if (typeof record.id === 'string') return record.id
    if (typeof record.model === 'string') return record.model
  }
  return undefined
}
