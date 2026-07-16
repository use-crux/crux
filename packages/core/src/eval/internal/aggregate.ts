/** Pure per-Variant aggregation for portable Eval cells. @internal */

import type { EvalCell, EvalVariantAggregate } from "./types";

export function aggregateVariant(
  cells: readonly EvalCell[],
): EvalVariantAggregate {
  const passed = cells.filter((cell) => cell.status === "passed").length;
  const costValues = cells.flatMap((cell) =>
    cell.metrics.costUsd === undefined ? [] : [cell.metrics.costUsd],
  );
  const scoreValues = new Map<string, number[]>();
  for (const score of cells.flatMap((cell) => cell.scores)) {
    if (score.status !== "computed" || score.value === null) continue;
    const values = scoreValues.get(score.name) ?? [];
    values.push(score.value);
    scoreValues.set(score.name, values);
  }
  const scores = Object.fromEntries(
    [...scoreValues].map(([name, values]) => {
      const mean = average(values);
      const variance =
        values.length < 2
          ? 0
          : values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
            (values.length - 1);
      return [
        name,
        Object.freeze({
          mean,
          sem: Math.sqrt(variance / values.length),
          n: values.length,
        }),
      ];
    }),
  );
  return Object.freeze({
    cells: cells.length,
    passed,
    failed: cells.filter((cell) => cell.status === "failed").length,
    errored: cells.filter((cell) => cell.status === "errored").length,
    skipped: 0 as const,
    passRate: cells.length === 0 ? 0 : passed / cells.length,
    scores: Object.freeze(scores),
    trialConsistency: trialConsistency(cells),
    latencyMs: average(cells.map((cell) => cell.metrics.durationMs)),
    ...(costValues.length > 0
      ? { knownCostUsd: costValues.reduce((total, cost) => total + cost, 0) }
      : {}),
  });
}

function trialConsistency(cells: readonly EvalCell[]): number {
  const cases = new Map<string, EvalCell["status"][]>();
  for (const cell of cells) {
    const statuses = cases.get(cell.caseId) ?? [];
    statuses.push(cell.status);
    cases.set(cell.caseId, statuses);
  }
  if (cases.size === 0) return 1;
  const consistent = [...cases.values()].filter((statuses) =>
    statuses.every((status) => status === statuses[0]),
  ).length;
  return consistent / cases.size;
}

function average(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}
