/**
 * Usage, cost, and governance metric aggregation for embeddings.
 *
 * Pure reducers that combine per-batch {@link EmbeddingUsage}, cost, and
 * {@link EmbeddingGovernanceMetrics} across chunks, plus compaction (drop empty
 * fields) and a small null-safe accessor. Internal helpers.
 *
 * @module
 */

import type { EmbeddingGovernanceMetrics, EmbeddingUsage } from './types'

/** Sum token usage across batch results, returning undefined when none present. */
export function combineUsage(usages: Array<EmbeddingUsage | undefined>): EmbeddingUsage | undefined {
  let inputTokens = 0
  let totalTokens = 0
  let hasInputTokens = false
  let hasTotalTokens = false

  for (const usage of usages) {
    if (!usage) continue
    if (usage.inputTokens !== undefined) {
      inputTokens += usage.inputTokens
      hasInputTokens = true
    }
    if (usage.totalTokens !== undefined) {
      totalTokens += usage.totalTokens
      hasTotalTokens = true
    }
  }

  if (!hasInputTokens && !hasTotalTokens) {
    return undefined
  }

  return {
    ...(hasInputTokens ? { inputTokens } : {}),
    ...(hasTotalTokens ? { totalTokens } : {}),
  }
}

/** Sum cost across batch results, returning undefined when none present. */
export function combineCost(costs: Array<number | undefined>): number | undefined {
  let total = 0
  let hasCost = false

  for (const cost of costs) {
    if (cost === undefined) continue
    total += cost
    hasCost = true
  }

  return hasCost ? total : undefined
}

/** Sum governance counters across metrics, compacting empty results to undefined. */
export function combineGovernance(
  metrics: Array<EmbeddingGovernanceMetrics | undefined>,
): EmbeddingGovernanceMetrics | undefined {
  const combined: EmbeddingGovernanceMetrics = {}
  for (const metric of metrics) {
    if (!metric) continue
    combined.cacheHitCount = addMetric(combined.cacheHitCount, metric.cacheHitCount)
    combined.cacheMissCount = addMetric(combined.cacheMissCount, metric.cacheMissCount)
    combined.retryCount = addMetric(combined.retryCount, metric.retryCount)
    combined.truncatedCount = addMetric(combined.truncatedCount, metric.truncatedCount)
    combined.rateLimitWaitMs = addMetric(combined.rateLimitWaitMs, metric.rateLimitWaitMs)
  }
  return compactGovernance(combined)
}

/** Drop empty/zero governance fields, returning undefined when nothing remains. */
export function compactGovernance(metrics: EmbeddingGovernanceMetrics): EmbeddingGovernanceMetrics | undefined {
  const compacted: EmbeddingGovernanceMetrics = {}
  if (metrics.cacheHitCount !== undefined) compacted.cacheHitCount = metrics.cacheHitCount
  if (metrics.cacheMissCount !== undefined) compacted.cacheMissCount = metrics.cacheMissCount
  if (metrics.retryCount !== undefined) compacted.retryCount = metrics.retryCount
  if (metrics.truncatedCount !== undefined) compacted.truncatedCount = metrics.truncatedCount
  if (metrics.rateLimitWaitMs !== undefined && metrics.rateLimitWaitMs > 0) {
    compacted.rateLimitWaitMs = metrics.rateLimitWaitMs
  }
  return Object.keys(compacted).length > 0 ? compacted : undefined
}

/** Coalesce governance metrics to a non-undefined object for event payloads. */
export function eventGovernance(metrics?: EmbeddingGovernanceMetrics): EmbeddingGovernanceMetrics {
  return metrics ?? {}
}

/** Null-safe add: returns left unchanged when right is undefined. */
function addMetric(left: number | undefined, right: number | undefined): number | undefined {
  if (right === undefined) {
    return left
  }
  return (left ?? 0) + right
}
