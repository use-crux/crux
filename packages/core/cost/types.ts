/**
 * Public type contracts for the cost-tracking domain.
 *
 * These describe model pricing tables, per-call cost entries, aggregated
 * cost reports, budget thresholds, and the `CostTracker` facade. They are
 * provider-agnostic: actual cost may come from provider usage metadata or be
 * estimated from a {@link ModelPricing} table.
 *
 * @module
 */

import type { CruxPlugin } from '../runtime/plugin'
import type { TokenUsage } from '../types'

/** Whether a recorded cost was reported by the provider or estimated locally. */
export type CostSource = 'actual' | 'estimated'

/** Per-model unit prices in USD per 1M tokens. */
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

/** A pricing table that can look up and estimate model costs. */
export interface ModelPricing {
  estimate(model: string, usage: TokenUsage): number | undefined
  get(model: string): ModelPrice | undefined
}

/** Additive cost + token totals, used both per-entry and per-group. */
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

/** A single recorded cost event with its trace/grouping dimensions. */
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

/** Aggregated cost across every recorded entry, grouped by dimension. */
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

/** Payload for the `cost:report` instrumentation hook. */
export interface CostReportEvent {
  timestamp: number
  entry: CostEntry
  report: CostReport
}

/** Payload for the `cost:warn` / `cost:limit` instrumentation hooks. */
export interface CostBudgetEvent extends CostReportEvent {
  threshold: number
  actual: number
}

/** Budget thresholds and callbacks for a cost-tracking session. */
export interface CostTrackingBudget {
  /** Emit `cost:warn` once the total session cost reaches this USD threshold. */
  warn?: number
  /** Throw once the total session cost reaches this USD threshold. */
  limit?: number
  onWarn?: (report: CostReport) => void
  onLimit?: (report: CostReport) => void
}

/** Options for {@link CostTracker} construction. */
export interface CostTrackingOptions {
  pricing?: ModelPricing
  budget?: CostTrackingBudget
}

/** A live cost tracker that records generations and reports totals. */
export interface CostTracker {
  readonly _tag: 'CostTracker'
  asPlugin(): CruxPlugin
  getReport(): CostReport
  reset(sessionId?: string): void
}
