/**
 * Run-level roll-up of per-turn explanation reports.
 *
 * The backend does not emit a separate run-level projection in V0; instead it
 * guarantees one {@link TurnDecisionReport} per generation turn under a shared
 * run id. The Run Detail run-root view aggregates those honestly here — a
 * failing-first summary the UI derives, never a second source of truth.
 */

import type { TurnDecisionReport } from "@/types";
import {
  normalizeTurnDecisionReport,
  type RuntimeTurnDecisionReport,
} from "./report";
import { turnHasWarningSignal } from "./signals";

/** The minimal recursive node shape this walk needs (a run-detail node). */
export interface ReportNode {
  id?: string;
  decisionReport?: RuntimeTurnDecisionReport | null;
  children?: readonly ReportNode[];
}

/** Pre-order list of every report folded onto a node tree (root first). */
export function collectTurnReports(node: ReportNode): TurnDecisionReport[] {
  const out: TurnDecisionReport[] = [];
  const walk = (n: ReportNode): void => {
    const report = normalizeTurnDecisionReport(n.decisionReport);
    if (report) out.push(report);
    for (const child of n.children ?? []) walk(child);
  };
  walk(node);
  return out;
}

/** A turn report paired with the tree node id that carries it (for selection). */
export interface TurnEntry {
  id: string;
  report: TurnDecisionReport;
}

/**
 * Pre-order list of `{ id, report }` for every turn under a node tree.
 *
 * The id is the tree node id (what selection navigates to), so the run-root
 * insight list can drill into a turn — which opens its Explain by default.
 */
export function collectTurnEntries(node: ReportNode): TurnEntry[] {
  const out: TurnEntry[] = [];
  const walk = (n: ReportNode): void => {
    const report = normalizeTurnDecisionReport(n.decisionReport);
    if (n.id && report) out.push({ id: n.id, report });
    for (const child of n.children ?? []) walk(child);
  };
  walk(node);
  return out;
}

/**
 * Ids of nodes whose turn explanation carries a warning signal.
 *
 * Drives the structure-lens warning badges: selecting one of these spans opens
 * Explain by default (see {@link turnInitialTab}), so the badge and the triage
 * default agree.
 */
export function warningTurnSpanIds(node: ReportNode): Set<string> {
  const ids = new Set<string>();
  const walk = (n: ReportNode): void => {
    const report = normalizeTurnDecisionReport(n.decisionReport);
    if (n.id && report && turnHasWarningSignal(report)) ids.add(n.id);
    for (const child of n.children ?? []) walk(child);
  };
  walk(node);
  return ids;
}

/** Aggregate counts across a run's per-turn reports. */
export interface RunAggregate {
  turns: number;
  needAttention: number;
  dropped: number;
  staleUsed: number;
  fallback: number;
  covered: number;
  total: number;
}

/** Fold per-turn reports into the run-root insight summary. */
export function aggregateRun(
  reports: readonly (
    | TurnDecisionReport
    | RuntimeTurnDecisionReport
    | null
    | undefined
  )[],
): RunAggregate {
  const agg: RunAggregate = {
    turns: 0,
    needAttention: 0,
    dropped: 0,
    staleUsed: 0,
    fallback: 0,
    covered: 0,
    total: 0,
  };
  for (const raw of reports) {
    const r = normalizeTurnDecisionReport(raw);
    if (!r) continue;
    agg.turns += 1;
    if (turnHasWarningSignal(r)) agg.needAttention += 1;
    agg.dropped += r.considered.filter(
      (c) => c.disposition === "dropped",
    ).length;
    agg.staleUsed += r.freshness.filter(
      (f) => f.status === "stale-used",
    ).length;
    agg.fallback += r.decisions.some((d) =>
      d.reason.code.startsWith("routing.fallback"),
    )
      ? 1
      : 0;
    agg.covered += r.coverage.covered;
    agg.total += r.coverage.total;
  }
  return agg;
}
