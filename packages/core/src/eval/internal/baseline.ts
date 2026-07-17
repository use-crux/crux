/** Pure construction and granular comparison for Eval Baseline V3. @internal */

import { BASELINE_FINGERPRINT_EPOCH } from "./evidence/cache-epochs";
import { fingerprintEvalValue } from "./identity";
import type {
  EvalBaselineCase,
  EvalBaselineComparison,
  EvalBaselineMetric,
  EvalBaselineV3,
} from "./baseline-types";
import type { EvalCell, EvalRun } from "./types";

export type { EvalBaselineComparison, EvalBaselineV3 } from "./baseline-types";

export interface BuildEvalBaselineOptions {
  readonly baselineId: string;
  readonly selectedArm?: string;
  readonly promotedAt: number;
  readonly promotedBy?: string;
  readonly toolVersion: string;
}

/** Build a privacy-safe Baseline from one complete selected arm. */
export function buildEvalBaseline(
  run: EvalRun,
  options: BuildEvalBaselineOptions,
): EvalBaselineV3 {
  if (run.status !== "complete") {
    throw new TypeError("Only a complete Eval run can be set as a Baseline");
  }
  if (run.selection.filtered === true) {
    throw new TypeError("A filtered Eval run cannot be set as a Baseline");
  }
  const selectedArm = options.selectedArm ?? "current";
  const variant = run.variants.find((entry) => entry.name === selectedArm);
  if (variant === undefined) throw new TypeError(`Eval run has no arm '${selectedArm}'`);
  const coverage = projectCoverage(run, selectedArm, true);
  const skippedCases = Object.freeze(
    run.cells
      .filter((cell) => cell.variant === selectedArm && cell.status === "skipped")
      .filter(
        (cell, index, all) =>
          all.findIndex((entry) => entry.caseId === cell.caseId) === index,
      )
      .map((cell) =>
        Object.freeze({
          caseId: cell.caseId,
          reason: cell.skipReason ?? "source_skipped",
        }),
      ),
  );
  const material = {
    schemaVersion: 3 as const,
    baselineFingerprintEpoch: BASELINE_FINGERPRINT_EPOCH,
    baselineId: options.baselineId,
    evalId: run.evalId,
    runId: run.runId,
    selectedArm,
    sourceKey: run.sourceKey,
    promotedAt: options.promotedAt,
    ...(options.promotedBy !== undefined
      ? { promotedBy: options.promotedBy }
      : {}),
    toolVersion: options.toolVersion,
    coverage,
    ...(skippedCases.length > 0 ? { skippedCases } : {}),
    provenance: {
      definitionFingerprint: run.definitionFingerprint,
      taskFingerprint: variant.fingerprint,
    },
    ...(!run.passed
      ? {
          warnings: Object.freeze([
            Object.freeze({
              code: "promoted_failing_run" as const,
              message: "The complete promoted run failed its authored Gates.",
            }),
          ]),
        }
      : {}),
  };
  return Object.freeze({
    ...material,
    baselineFingerprintEpoch: 2 as const,
    snapshotFingerprint: fingerprintEvalValue(material),
  });
}

/** Compare the Baseline arm per Case and metric; task/Gate drift is diagnostic only. */
export function compareEvalRunToBaseline(
  run: EvalRun,
  baseline: EvalBaselineV3,
): EvalBaselineComparison {
  return compareEvalCellsToBaseline(run.cells, baseline);
}

/** Compare already executed cells without requiring a synthetic run record. */
export function compareEvalCellsToBaseline(
  cells: readonly EvalCell[],
  baseline: EvalBaselineV3,
): EvalBaselineComparison {
  const candidate = projectCellCoverage(cells, baseline.selectedArm, false);
  const byCase = new Map(candidate.map((entry) => [entry.caseId, entry]));
  const baselineIDs = new Set(baseline.coverage.map((entry) => entry.caseId));
  const candidateSkipped = new Set(
    cells
      .filter(
        (cell) =>
          cell.variant === baseline.selectedArm && cell.status === "skipped",
      )
      .map((cell) => cell.caseId),
  );
  const baselineSkipped = new Set(
    (baseline.skippedCases ?? []).map((entry) => entry.caseId),
  );
  const cases = [
    ...baseline.coverage.map((reference) =>
      candidateSkipped.has(reference.caseId)
        ? Object.freeze({
            caseId: reference.caseId,
            status: "incompatible" as const,
            reason: "skip_state_changed",
            metrics: Object.freeze([]),
          })
        : compareCase(reference, byCase.get(reference.caseId)),
    ),
    ...(baseline.skippedCases ?? []).flatMap((skipped) =>
      candidateSkipped.has(skipped.caseId)
        ? []
        : [
            Object.freeze({
              caseId: skipped.caseId,
              status: "incompatible" as const,
              reason: "skip_state_changed",
              metrics: Object.freeze([]),
            }),
          ],
    ),
  ];
  return Object.freeze({
    baselineId: baseline.baselineId,
    baselineRunId: baseline.runId,
    selectedArm: baseline.selectedArm,
    cases: Object.freeze(cases),
    unmatchedCases: Object.freeze({
      baselineOnly: Object.freeze(
        cases.filter((entry) => entry.status === "missing").map((entry) => entry.caseId),
      ),
      candidateOnly: Object.freeze(
        candidate
          .filter(
            (entry) =>
              !baselineIDs.has(entry.caseId) &&
              !baselineSkipped.has(entry.caseId),
          )
          .map((entry) => entry.caseId),
      ),
    }),
  });
}

function projectCoverage(
  run: EvalRun,
  arm: string,
  enforceComplete: boolean,
): readonly EvalBaselineCase[] {
  const cells = run.cells.filter((cell) => cell.variant === arm);
  if (enforceComplete) {
    const present = new Set(cells.map((cell) => cell.caseId));
    for (const caseId of run.selection.cases) {
      if (!present.has(caseId)) {
        throw new TypeError(`Arm '${arm}' is incomplete for Case '${caseId}'`);
      }
      const expectedTrials = run.selection.caseTrials[caseId];
      const actualTrials = cells
        .filter((cell) => cell.caseId === caseId)
        .map((cell) => cell.trial)
        .sort((left, right) => left - right);
      if (
        expectedTrials === undefined ||
        actualTrials.length !== expectedTrials ||
        actualTrials.some((trial, index) => trial !== index)
      ) {
        throw new TypeError(
          `Arm '${arm}' is incomplete for Case '${caseId}': expected every trial`,
        );
      }
    }
  }
  return projectCellCoverage(cells, arm, enforceComplete);
}

function projectCellCoverage(
  cells: readonly EvalCell[],
  arm: string,
  enforceComplete: boolean,
): readonly EvalBaselineCase[] {
  const byCase = new Map<string, EvalCell[]>();
  for (const cell of cells) {
    if (cell.variant !== arm) continue;
    if (cell.status === "skipped") continue;
    const entries = byCase.get(cell.caseId) ?? [];
    entries.push(cell);
    byCase.set(cell.caseId, entries);
  }
  if (enforceComplete) {
    for (const [caseId, entries] of byCase) {
      if (entries.some((cell) => cell.status === "errored")) {
        throw new TypeError(`Arm '${arm}' is incomplete for Case '${caseId}'`);
      }
    }
  }
  return Object.freeze(
    [...byCase].map(([caseId, entries]) => projectCase(caseId, entries, enforceComplete)),
  );
}

function projectCase(
  caseId: string,
  cells: readonly EvalCell[],
  enforceComplete: boolean,
): EvalBaselineCase {
  const first = cells[0]!;
  const metrics = new Map<string, EvalBaselineMetric>();
  for (const cell of cells) {
    for (const score of cell.scores) {
      if (score.status !== "computed") {
        if (enforceComplete) throw new TypeError(`Metric '${score.name}' is incomplete`);
        continue;
      }
      const existing = metrics.get(score.name);
      if (existing !== undefined && existing.contractFingerprint !== score.contractFingerprint) {
        throw new TypeError(`Metric '${score.name}' has mixed scorer contracts`);
      }
      metrics.set(score.name, {
        contractFingerprint: score.contractFingerprint,
        aggregation: "arithmetic_mean_non_null_v1",
        values: Object.freeze([
          ...(existing?.values ?? []),
          Object.freeze({
            trial: cell.trial,
            value: score.value,
            ...(score.label !== undefined ? { label: score.label } : {}),
          }),
        ]),
      });
    }
  }
  return Object.freeze({
    caseId,
    inputFingerprint: fingerprintEvalValue(first.input),
    callFingerprint: fingerprintEvalValue(first.call ?? null),
    expectedFingerprint: fingerprintEvalValue(first.expected ?? null),
    trials: Object.freeze(cells.map((cell) => cell.trial).sort((a, b) => a - b)),
    metrics: Object.freeze(Object.fromEntries(metrics)),
  });
}

function compareCase(
  reference: EvalBaselineCase,
  candidate: EvalBaselineCase | undefined,
) {
  if (candidate === undefined) {
    return Object.freeze({ caseId: reference.caseId, status: "missing" as const, reason: "case_missing", metrics: Object.freeze([]) });
  }
  const identityMatches =
    reference.inputFingerprint === candidate.inputFingerprint &&
    reference.callFingerprint === candidate.callFingerprint &&
    reference.expectedFingerprint === candidate.expectedFingerprint &&
    reference.trials.join(",") === candidate.trials.join(",");
  if (!identityMatches) {
    return Object.freeze({ caseId: reference.caseId, status: "incompatible" as const, reason: "case_contract_changed", metrics: Object.freeze([]) });
  }
  const metrics = Object.entries(reference.metrics).map(([name, baselineMetric]) => {
    const current = candidate.metrics[name];
    if (current === undefined) return Object.freeze({ name, status: "missing" as const, reason: "metric_missing" });
    if (current.contractFingerprint !== baselineMetric.contractFingerprint || current.aggregation !== baselineMetric.aggregation) {
      return Object.freeze({ name, status: "incompatible" as const, reason: "metric_contract_changed" });
    }
    const baselineValue = mean(baselineMetric.values.map((entry) => entry.value));
    const candidateValue = mean(current.values.map((entry) => entry.value));
    return Object.freeze({
      name,
      status: "compatible" as const,
      baseline: baselineValue,
      candidate: candidateValue,
      delta: baselineValue === null || candidateValue === null ? null : candidateValue - baselineValue,
    });
  });
  const status = metrics.some((metric) => metric.status === "incompatible")
    ? ("incompatible" as const)
    : metrics.some((metric) => metric.status === "missing")
      ? ("missing" as const)
      : ("compatible" as const);
  return Object.freeze({ caseId: reference.caseId, status, metrics: Object.freeze(metrics) });
}

function mean(values: readonly (number | null)[]): number | null {
  const numbers = values.filter((value): value is number => value !== null);
  return numbers.length === 0 ? null : numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}
