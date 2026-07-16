/** Pure authored/default blocking policy across Current and candidate arms. @internal */

import type { EvalCell, EvalGateSummary } from "./types";
import type { EvalBaselineComparison } from "./baseline-types";

export function evaluateBlockingGates(
  cells: readonly EvalCell[],
  blockingVariants: readonly string[],
  authoredGates?: unknown,
  comparison?: EvalBaselineComparison,
  evalId?: string,
): EvalGateSummary {
  const blocking = new Set(blockingVariants);
  const variants = [...new Set(cells.map((cell) => cell.variant))];
  const results = Object.freeze(
    variants.flatMap((variant) => {
      const variantCells = cells.filter((cell) => cell.variant === variant);
      const raw =
        authoredGates === undefined
          ? defaultGate(variantCells)
          : authoredGateResults(
              variantCells,
              authoredGates,
              variant,
              comparison,
              evalId,
            );
      return raw.map((result) =>
        Object.freeze({
          ...result,
          variantName: variant,
          ...(!blocking.has(variant) ? { informational: true as const } : {}),
        }),
      );
    }),
  );
  const passed = results
    .filter((result) => blocking.has(result.variantName))
    .every((result) => result.passed || result.informational === true);
  return Object.freeze({
    passed,
    blockingPassed: passed,
    results,
  });
}

function defaultGate(cells: readonly EvalCell[]) {
  const actual = cells
    .filter((cell) => cell.status !== "skipped")
    .every((cell) => cell.status === "passed");
  return [{ gate: "pass", threshold: true, actual, passed: actual }];
}

function authoredGateResults(
  cells: readonly EvalCell[],
  value: unknown,
  variant: string,
  comparison?: EvalBaselineComparison,
  evalId?: string,
) {
  const gates = isRecord(value) ? value : {};
  cells = cells.filter((cell) => cell.status !== "skipped");
  const results: Array<{
    gate: string;
    threshold: number | boolean;
    actual: number | boolean;
    passed: boolean;
    informational?: true;
    evidence?: "complete" | "incomplete";
    reason?: "baseline_missing" | "baseline_evidence_incomplete";
    remediation?: string;
  }> = [];
  const passRate = numberAt(gates.passRate, "min");
  if (passRate !== undefined) {
    const actual = ratio(
      cells.filter((cell) => cell.status === "passed").length,
      cells.length,
    );
    results.push({
      gate: "passRate.min",
      threshold: passRate,
      actual,
      passed: actual >= passRate,
    });
  }
  const latency = isRecord(gates.latency) ? gates.latency : {};
  addMaximum(
    results,
    "latency.meanMs",
    numberAt(latency, "meanMs"),
    mean(cells.map((cell) => cell.metrics.durationMs)),
  );
  addMaximum(
    results,
    "latency.p95Ms",
    numberAt(latency, "p95Ms"),
    percentile(
      cells.map((cell) => cell.metrics.durationMs),
      0.95,
    ),
  );
  const cost = isRecord(gates.cost) ? gates.cost : {};
  const costs = cells.map((cell) => cell.metrics.costUsd ?? 0);
  addMaximum(
    results,
    "cost.maxPerCaseUsd",
    numberAt(cost, "maxPerCaseUsd"),
    costs.length === 0 ? 0 : Math.max(...costs),
  );
  addMaximum(
    results,
    "cost.maxTotalUsd",
    numberAt(cost, "maxTotalUsd"),
    costs.reduce((total, entry) => total + entry, 0),
  );
  addScoreGates(results, cells, gates.scores, variant, comparison, evalId);
  addConsistencyGates(results, cells, gates.consistency);
  return results;
}

function addConsistencyGates(
  results: ReturnType<typeof authoredGateResults>,
  cells: readonly EvalCell[],
  value: unknown,
): void {
  if (!isRecord(value)) return;
  const byCase = new Map<string, EvalCell[]>();
  for (const cell of cells) {
    const group = byCase.get(cell.caseId) ?? [];
    group.push(cell);
    byCase.set(cell.caseId, group);
  }
  const groups = [...byCase.values()];
  const passAtK = ratio(
    groups.filter((group) => group.some((cell) => cell.status === "passed"))
      .length,
    groups.length,
  );
  const minimum = numberAt(value, "passAtK");
  if (minimum !== undefined) {
    results.push({
      gate: "consistency.passAtK",
      threshold: minimum,
      actual: passAtK,
      passed: passAtK >= minimum,
    });
  }
  if (value.passAllTrials === true) {
    const actual =
      groups.length > 0 &&
      groups.every((group) => group.every((cell) => cell.status === "passed"));
    results.push({
      gate: "consistency.passAllTrials",
      threshold: true,
      actual,
      passed: actual,
    });
  }
}

function addScoreGates(
  results: ReturnType<typeof authoredGateResults>,
  cells: readonly EvalCell[],
  value: unknown,
  variant: string,
  comparison?: EvalBaselineComparison,
  evalId?: string,
): void {
  if (!isRecord(value)) return;
  for (const [name, raw] of Object.entries(value)) {
    if (!isRecord(raw)) continue;
    const values = cells.flatMap((cell) =>
      cell.scores.flatMap((score) =>
        score.status === "computed" &&
        score.name === name &&
        score.value !== null
          ? [score.value]
          : [],
      ),
    );
    const actual = mean(values);
    const minimum = numberAt(raw, "min");
    if (minimum !== undefined)
      results.push({
        gate: `scores.${name}.min`,
        threshold: minimum,
        actual,
        passed: actual >= minimum,
      });
    const maximum = numberAt(raw, "max");
    if (maximum !== undefined)
      results.push({
        gate: `scores.${name}.max`,
        threshold: maximum,
        actual,
        passed: actual <= maximum,
      });
    const delta = numberAt(raw, "minDeltaVsBaseline");
    if (delta !== undefined) {
      const relevantCases =
        comparison?.selectedArm === variant ? comparison.cases : [];
      const evidenceComplete =
        relevantCases.length > 0 &&
        relevantCases.every(
          (entry) =>
            entry.status === "compatible" &&
            entry.metrics.some(
              (metric) => metric.name === name && metric.status === "compatible",
            ),
        );
      const deltas =
        evidenceComplete
          ? relevantCases.flatMap((entry) =>
              entry.metrics.flatMap((metric) =>
                metric.name === name &&
                metric.status === "compatible" &&
                metric.delta !== null
                  ? [metric.delta]
                  : [],
              ),
            )
          : [];
      const comparable = deltas.length > 0;
      const actual = comparable ? mean(deltas) : 0;
      const reason =
        comparison === undefined
          ? ("baseline_missing" as const)
          : ("baseline_evidence_incomplete" as const);
      results.push({
        gate: `scores.${name}.minDeltaVsBaseline`,
        threshold: delta,
        actual,
        passed: comparable ? actual >= delta : false,
        evidence: comparable ? ("complete" as const) : ("incomplete" as const),
        ...(!comparable
          ? {
              reason,
              remediation: `crux eval baseline set${evalId === undefined ? "" : ` ${evalId}`}`,
            }
          : {}),
      });
    }
  }
}

function addMaximum(
  results: ReturnType<typeof authoredGateResults>,
  gate: string,
  threshold: number | undefined,
  actual: number,
): void {
  if (threshold !== undefined)
    results.push({ gate, threshold, actual, passed: actual <= threshold });
}

function numberAt(value: unknown, key: string): number | undefined {
  if (!isRecord(value)) return undefined;
  const entry = value[key];
  return typeof entry === "number" ? entry : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function mean(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: readonly number[], quantile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(quantile * sorted.length) - 1] ?? 0;
}
