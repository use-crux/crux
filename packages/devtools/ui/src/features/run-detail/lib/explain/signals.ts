/**
 * Warning-signal derivation for the Run Detail `Explain` tab.
 *
 * The runtime plane is failure-first: a turn that carries a debugging signal
 * opens `Explain` by default and pushes that signal into the span sub-header,
 * so the warning is visible no matter which tab the user lands on. These helpers
 * read the deterministic {@link TurnDecisionReport} — never model internals — so
 * the default-tab choice is testable and stable across renders.
 *
 * What counts as a warning signal is deliberately the *strong, specific* set
 * (error/blocked status, stale-used evidence, a dropped required context, a
 * fired fallback, a guardrail/security block). Coverage gaps are surfaced as
 * chips but do **not** force `Explain` open — most turns are partially
 * unprotected, and crying wolf on every turn would defeat the triage default.
 */

import type { TurnDecisionReport } from '@/types'
import { normalizeTurnDecisionReport, type RuntimeTurnDecisionReport } from './report'
import type { ExplainGenTab } from './tabs'

/** A turn status that is not a clean success. */
function statusIsWarning(status: string | undefined): boolean {
  return status != null && status !== 'ok' && status !== 'success' && status !== 'running'
}

/** True when a fired fallback is recorded among the decisions. */
function hasFiredFallback(report: TurnDecisionReport): boolean {
  return report.decisions.some((d) => d.reason.code.startsWith('routing.fallback'))
}

/** True when a guardrail or security check blocked input or output. */
function hasSafetyBlock(report: TurnDecisionReport): boolean {
  return report.decisions.some(
    (d) => d.reason.code === 'guardrail.blocked' || d.reason.code === 'security.blocked',
  )
}

/** True when evidence was used while stale (the risk a debugger must not miss). */
function hasStaleUsed(report: TurnDecisionReport): boolean {
  return report.freshness.some((f) => f.status === 'stale-used')
}

/** True when a context the turn declared as required was dropped before sending. */
function hasDroppedRequired(report: TurnDecisionReport): boolean {
  return report.considered.some((c) => c.required === true && c.disposition === 'dropped')
}

/**
 * Whether this turn carries a debugging signal worth leading with.
 *
 * Pure over recorded report facts; see the module note for why coverage gaps
 * are intentionally excluded from this set.
 */
export function turnHasWarningSignal(report: TurnDecisionReport | RuntimeTurnDecisionReport): boolean {
  const normalized = normalizeTurnDecisionReport(report)
  if (!normalized) return false
  return (
    statusIsWarning(normalized.turn.status) ||
    hasStaleUsed(normalized) ||
    hasDroppedRequired(normalized) ||
    hasFiredFallback(normalized) ||
    hasSafetyBlock(normalized)
  )
}

/**
 * The tab the generation detail pane should open by default.
 *
 * `Explain` for a turn with a warning signal, `Output` otherwise — including
 * when no report is available, preserving the existing default.
 */
export function turnInitialTab(report: TurnDecisionReport | RuntimeTurnDecisionReport | null | undefined): ExplainGenTab {
  if (report && turnHasWarningSignal(report)) return 'explain'
  return 'output'
}
