/**
 * Cost tracking — `@use-crux/core/cost`.
 *
 * Provider-agnostic cost accounting: build a {@link ModelPricing} table with
 * {@link modelPricing}, install {@link withCostTracking} as a plugin to record
 * actual or estimated generation cost, and read aggregated {@link CostReport}s.
 * Budget thresholds emit warnings and throw {@link CostLimitError}.
 *
 * @module
 */

export type {
  CostSource,
  ModelPrice,
  ModelPricing,
  CostBreakdown,
  CostEntry,
  CostReport,
  CostReportEvent,
  CostBudgetEvent,
  CostTrackingBudget,
  CostTrackingOptions,
  CostTracker,
} from './types'

export { modelPricing } from './pricing'
export { withCostTracking, CostLimitError } from './tracking'
