import type { CruxPlugin } from '../plugin'
import { observe } from '../observability'
import { getRuntime } from '../runtime'
import { getExecutionContext } from '../execution-context'
import type { PromptMiddlewareArgs, TokenUsage, TraceMeta } from '../types'

export type CostSource = 'actual' | 'estimated'

export interface ModelPrice {
  /** USD per 1M input tokens. */
  input: number
  /** USD per 1M output tokens. */
  output: number
  /** USD per 1M cached input read tokens. */
  cacheRead?: number
  /** USD per 1M cached input write tokens. */
  cacheWrite?: number
  /** USD per 1M reasoning tokens, when providers report them separately. */
  reasoning?: number
}

export interface ModelPricing {
  estimate(model: string, usage: TokenUsage): number | undefined
  get(model: string): ModelPrice | undefined
}

export interface CostBreakdown {
  cost: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  calls: number
}

export interface CostEntry extends CostBreakdown {
  id: string
  timestamp: number
  source: CostSource
  promptId?: string
  model?: string
  provider?: string
  traceId?: string
  sessionId?: string
  flowId?: string
  stepId?: string
  stepLabel?: string
  agentId?: string
}

export interface CostReport {
  total: CostBreakdown
  byPrompt: Record<string, CostBreakdown>
  byModel: Record<string, CostBreakdown>
  byProvider: Record<string, CostBreakdown>
  byAgent: Record<string, CostBreakdown>
  byFlow: Record<string, CostBreakdown>
  bySession: Record<string, CostBreakdown>
  byStep: Record<string, CostBreakdown>
  entries: CostEntry[]
}

export interface CostReportEvent {
  timestamp: number
  entry: CostEntry
  report: CostReport
}

export interface CostBudgetEvent extends CostReportEvent {
  threshold: number
  actual: number
}

export interface CostTrackingBudget {
  /** Emit `cost:warn` once the total session cost reaches this USD threshold. */
  warn?: number
  /** Throw once the total session cost reaches this USD threshold. */
  limit?: number
  onWarn?: (report: CostReport) => void
  onLimit?: (report: CostReport) => void
}

export interface CostTrackingOptions {
  pricing?: ModelPricing
  budget?: CostTrackingBudget
}

export interface CostTracker {
  readonly _tag: 'CostTracker'
  asPlugin(): CruxPlugin
  getReport(): CostReport
  reset(sessionId?: string): void
}

const EMPTY_BREAKDOWN: CostBreakdown = {
  cost: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  reasoningTokens: 0,
  calls: 0,
}

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

export function modelPricing(prices: Record<string, ModelPrice>): ModelPricing {
  const table = { ...prices }

  function get(model: string): ModelPrice | undefined {
    return table[model] ?? table[stripProvider(model)] ?? table[stripVersionSuffix(stripProvider(model))]
  }

  return {
    get,
    estimate(model, usage) {
      const price = get(model)
      if (!price) return undefined

      const input = usage.inputTokens ?? 0
      const output = usage.outputTokens ?? 0
      const cacheRead = usage.cacheReadTokens ?? 0
      const cacheWrite = usage.cacheWriteTokens ?? 0
      const reasoning = usage.reasoningTokens ?? 0
      return (
        (input * price.input +
          output * price.output +
          cacheRead * (price.cacheRead ?? price.input) +
          cacheWrite * (price.cacheWrite ?? price.input) +
          reasoning * (price.reasoning ?? price.output)) /
        1_000_000
      )
    },
  }
}

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
    const hooks = getRuntime().instrumentationHooks
    const span = observe.openSpan({
      name: 'cost.record',
      family: 'cost',
      primitive: 'cost.record',
      attributes: {
        ...costEntryAttributes(entry),
        totalCost: report.total.cost,
        totalCalls: report.total.calls,
      },
    })

    span.withContext(() => {
      hooks?.onCostReport?.({ timestamp: Date.now(), entry, report })
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
      hooks?.onCostWarn?.({ timestamp: Date.now(), entry, report, threshold: warn, actual: report.total.cost })
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
      hooks?.onCostLimit?.({ timestamp: Date.now(), entry, report, threshold: limit, actual: report.total.cost })
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
      ...costEntryAttributes(entry),
      totalCost: report.total.cost,
      totalCalls: report.total.calls,
      warning,
      limited: false,
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

function getResultMeta(
  result: unknown,
): (TraceMeta & { _streamCompletion?: Promise<TraceMeta | undefined> }) | undefined {
  if (result && typeof result === 'object' && '_meta' in result) {
    return (result as { _meta?: TraceMeta & { _streamCompletion?: Promise<TraceMeta | undefined> } })._meta
  }
  return undefined
}

function costEntryAttributes(entry: CostEntry): Record<string, unknown> {
  return {
    entryId: entry.id,
    source: entry.source,
    cost: entry.cost,
    inputTokens: entry.inputTokens,
    outputTokens: entry.outputTokens,
    totalTokens: entry.totalTokens,
    cacheReadTokens: entry.cacheReadTokens,
    cacheWriteTokens: entry.cacheWriteTokens,
    reasoningTokens: entry.reasoningTokens,
    calls: entry.calls,
    promptId: entry.promptId,
    model: entry.model,
    provider: entry.provider,
    traceId: entry.traceId,
    sessionId: entry.sessionId,
    flowId: entry.flowId,
    stepId: entry.stepId,
    stepLabel: entry.stepLabel,
    agentId: entry.agentId,
  }
}

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

function buildReport(entries: CostEntry[]): CostReport {
  const report: CostReport = {
    total: { ...EMPTY_BREAKDOWN },
    byPrompt: {},
    byModel: {},
    byProvider: {},
    byAgent: {},
    byFlow: {},
    bySession: {},
    byStep: {},
    entries: entries.map((entry) => ({ ...entry })),
  }

  for (const entry of entries) {
    add(report.total, entry)
    addGroup(report.byPrompt, entry.promptId, entry)
    addGroup(report.byModel, entry.model, entry)
    addGroup(report.byProvider, entry.provider, entry)
    addGroup(report.byAgent, entry.agentId, entry)
    addGroup(report.byFlow, entry.flowId, entry)
    addGroup(report.bySession, entry.sessionId, entry)
    addGroup(report.byStep, entry.stepId, entry)
  }

  return report
}

function addGroup(group: Record<string, CostBreakdown>, key: string | undefined, entry: CostEntry): void {
  if (!key) return
  group[key] ??= { ...EMPTY_BREAKDOWN }
  add(group[key], entry)
}

function add(target: CostBreakdown, entry: CostBreakdown): void {
  target.cost += entry.cost
  target.inputTokens += entry.inputTokens
  target.outputTokens += entry.outputTokens
  target.totalTokens += entry.totalTokens
  target.cacheReadTokens += entry.cacheReadTokens
  target.cacheWriteTokens += entry.cacheWriteTokens
  target.reasoningTokens += entry.reasoningTokens
  target.calls += entry.calls
}

function stripProvider(model: string): string {
  const slash = model.lastIndexOf('/')
  return slash === -1 ? model : model.slice(slash + 1)
}

function stripVersionSuffix(model: string): string {
  const colon = model.indexOf(':')
  return colon === -1 ? model : model.slice(0, colon)
}
