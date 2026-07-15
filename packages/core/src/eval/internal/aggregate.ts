/** Pure Current-arm aggregation for the Phase 5 tracer. @internal */

import type { EvalCell, EvalVariantAggregate } from "./types";

export function aggregateCurrent(cell: EvalCell): EvalVariantAggregate {
  const costUsd = cell.metrics.costUsd;
  const scores = Object.fromEntries(
    cell.scores.flatMap((score) =>
      score.status === "computed" && score.value !== null
        ? [[score.name, Object.freeze({ mean: score.value, sem: 0, n: 1 })]]
        : [],
    ),
  );
  return Object.freeze({
    cells: 1,
    passed: cell.status === "passed" ? 1 : 0,
    failed: cell.status === "failed" ? 1 : 0,
    errored: cell.status === "errored" ? 1 : 0,
    skipped: 0 as const,
    passRate: cell.status === "passed" ? 1 : 0,
    scores: Object.freeze(scores),
    trialConsistency: 1,
    latencyMs: cell.metrics.durationMs,
    ...(costUsd !== undefined ? { knownCostUsd: costUsd } : {}),
  });
}
