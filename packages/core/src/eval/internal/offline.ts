/** Strict-offline external-work classification and diagnostics. @internal */

import type { EvalPlannedCell } from "./types";
import type { EvalOfflineMiss, EvalPlanPreflight } from "./offline-types";
import { resolveEvalScorers } from "./scorer-plan";

/** Structured failure raised before a blocked offline plan can execute. */
export class EvalOfflinePreflightError extends Error {
  readonly name = "EvalOfflinePreflightError";
  readonly misses: readonly EvalOfflineMiss[];

  constructor(evalId: string, misses: readonly EvalOfflineMiss[]) {
    super(renderEvalOfflineMisses(evalId, misses));
    this.misses = misses;
  }
}

/** Classify all external work without invoking callbacks or hosts. */
export function createEvalPreflight(
  cells: readonly EvalPlannedCell[],
  rawScorers: unknown,
  offline: boolean,
): EvalPlanPreflight {
  if (!offline) return READY_ONLINE;
  const misses = collectEvalOfflineMisses(cells, rawScorers);
  return misses.length === 0
    ? READY_OFFLINE
    : Object.freeze({
        status: "blocked" as const,
        reason: "offline_miss" as const,
        offline: true as const,
        misses,
      });
}

/** Reject a blocked plan before any execution-side port is observed. */
export function assertEvalPreflightReady(
  evalId: string,
  preflight: EvalPlanPreflight,
): void {
  if (preflight.status === "blocked") {
    throw new EvalOfflinePreflightError(evalId, preflight.misses);
  }
}

/** Render human guidance without making the message a parsing contract. */
export function renderEvalOfflineMisses(
  evalId: string,
  misses: readonly EvalOfflineMiss[],
): string {
  const noun = misses.length === 1 ? "result" : "results";
  return [
    `Offline run needs ${misses.length} uncached ${noun}; no external calls were made.`,
    ...misses.map((miss) => `- ${renderMiss(evalId, miss)}`),
    `Run \`crux eval ${evalId}\` online, or remove \`--offline\`.`,
  ].join("\n");
}

function collectEvalOfflineMisses(
  cells: readonly EvalPlannedCell[],
  rawScorers: unknown,
): readonly EvalOfflineMiss[] {
  const misses: EvalOfflineMiss[] = [];
  const scorers = resolveEvalScorers(rawScorers);
  for (const cell of cells) {
    if (cell.action.kind === "execute") {
      misses.push(
        Object.freeze({
          kind: "task" as const,
          actionId: `${cell.caseId}:${cell.variant}:${cell.trial}:task`,
          caseId: cell.caseId,
          variant: cell.variant,
          trial: cell.trial,
          externalKind: "task" as const,
          reason: cell.action.reason,
        }),
      );
    }
    let managedIndex = 0;
    for (const [index, scorer] of scorers.entries()) {
      if (scorer.costClass === "code") continue;
      if (scorer.costClass === "model") {
        const action = cell.scorerActions[managedIndex++];
        if (action === undefined || action.kind === "reuse") continue;
        misses.push(
          Object.freeze({
            kind: "scorer" as const,
            actionId: action.actionId,
            caseId: cell.caseId,
            variant: cell.variant,
            trial: cell.trial,
            scorerName: action.scorerName,
            externalKind: action.externalKind,
            reason:
              cell.action.kind === "execute"
                ? ("task_dependency_unresolved" as const)
                : action.reason,
          }),
        );
        continue;
      }
      const scorerName = scorer.scorerName ?? scorer.name ?? "(dynamic)";
      misses.push(
        Object.freeze({
          kind: "scorer" as const,
          actionId: `${cell.caseId}:${cell.variant}:${cell.trial}:unknown-score:${index}:${scorerName}`,
          caseId: cell.caseId,
          variant: cell.variant,
          trial: cell.trial,
          scorerName,
          externalKind: "unknown" as const,
          reason: "external_classification_unknown" as const,
        }),
      );
    }
  }
  return Object.freeze(misses);
}

function renderMiss(evalId: string, miss: EvalOfflineMiss): string {
  const trial = miss.trial + 1;
  if (miss.kind === "task") {
    return `${evalId}/${miss.caseId}/${miss.variant}/trial-${trial}: ${taskReason(miss.reason)}`;
  }
  return `${evalId}/${miss.caseId}/${miss.variant}/${miss.scorerName}: ${
    miss.reason === "task_dependency_unresolved"
      ? "external scorer unresolved because task evidence is missing"
      : `no exact external scorer evidence (${miss.reason})`
  }`;
}

function taskReason(
  reason: Extract<EvalOfflineMiss, { readonly kind: "task" }>["reason"],
): string {
  switch (reason) {
    case "no_exact_evidence":
      return "no exact task evidence";
    case "fresh_requested":
      return "explicit fresh execution requires a live task";
    case "performance_freshness":
      return "performance evidence requires a live task";
    default:
      return `task evidence unavailable (${reason})`;
  }
}

const READY_ONLINE: EvalPlanPreflight = Object.freeze({
  status: "admitted",
  offline: false,
  misses: Object.freeze([]) as readonly [],
});

const READY_OFFLINE: EvalPlanPreflight = Object.freeze({
  status: "admitted",
  offline: true,
  misses: Object.freeze([]) as readonly [],
});
