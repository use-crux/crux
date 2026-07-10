/**
 * Cost report aggregation.
 *
 * Pure helpers that fold a flat list of {@link CostEntry} into an aggregated
 * {@link CostReport} (totals plus per-prompt/model/provider/agent/flow/
 * session/step breakdowns) and flatten an entry into span attributes. These
 * are intra-domain helpers consumed by the tracker; they are not part of the
 * public package surface.
 *
 * @module
 */

import type { CostBreakdown, CostEntry, CostReport } from './types'

/** A zeroed {@link CostBreakdown}; spread to seed totals and group buckets. */
export const EMPTY_BREAKDOWN: CostBreakdown = {
  cost: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  reasoningTokens: 0,
  calls: 0,
}

/** Fold entries into a {@link CostReport} with totals and grouped breakdowns. */
export function buildReport(entries: CostEntry[]): CostReport {
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

/** Add an entry into a keyed breakdown group, seeding the bucket on first use. */
function addGroup(group: Record<string, CostBreakdown>, key: string | undefined, entry: CostEntry): void {
  if (!key) return
  group[key] ??= { ...EMPTY_BREAKDOWN }
  add(group[key], entry)
}

/** Accumulate one breakdown's cost + token counts into another in place. */
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

/** Flatten a {@link CostEntry} into a span/event attribute bag. */
export function costEntryAttributes(entry: CostEntry): Record<string, unknown> {
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
