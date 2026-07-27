/** Pure granular comparison of Eval Runs against Baseline coverage. @internal */

import type {
  EvalBaselineCase,
  EvalBaselineComparison,
  EvalBaselineV3,
} from "./baseline-types";
import {
  projectCandidateBaselineCoverage,
  type EvalCandidateBaselineCase,
} from "./baseline-coverage";
import type { EvalCellV3, EvalCellV4 } from "./cell-types";
import type { EvalRun } from "./run-types";
import { UNVERSIONED_LOCAL_SCORER_CONTRACT } from "./scorers/runtime";

/** Compare the Baseline arm per Case and metric; task/Gate drift is diagnostic only. */
export function compareEvalRunToBaseline(
  run: EvalRun,
  baseline: EvalBaselineV3,
): EvalBaselineComparison {
  return compareEvalCellsToBaseline(run.cells, baseline);
}

/** Compare already executed cells without requiring a synthetic run record. */
export function compareEvalCellsToBaseline(
  cells: readonly (EvalCellV3 | EvalCellV4)[],
  baseline: EvalBaselineV3,
): EvalBaselineComparison {
  const candidate = projectCandidateBaselineCoverage(
    cells,
    baseline.selectedArm,
  );
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
        cases
          .filter((entry) => entry.status === "missing")
          .map((entry) => entry.caseId),
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

function compareCase(
  reference: EvalBaselineCase,
  candidate: EvalCandidateBaselineCase | undefined,
) {
  if (candidate === undefined) {
    return Object.freeze({
      caseId: reference.caseId,
      status: "missing" as const,
      reason: "case_missing",
      metrics: Object.freeze([]),
    });
  }
  const identityMatches =
    reference.inputFingerprint === candidate.inputFingerprint &&
    reference.callFingerprint === candidate.callFingerprint &&
    reference.expectedFingerprint === candidate.expectedFingerprint &&
    reference.trials.join(",") === candidate.trials.join(",");
  if (!identityMatches) {
    return Object.freeze({
      caseId: reference.caseId,
      status: "incompatible" as const,
      reason: "case_contract_changed",
      metrics: Object.freeze([]),
    });
  }
  const outcomesMatch =
    reference.outcomes.length === candidate.outcomes.length &&
    reference.outcomes.every(
      (outcome, index) =>
        outcome.trial === candidate.outcomes[index]?.trial &&
        outcome.status === candidate.outcomes[index]?.status,
    );
  if (!outcomesMatch) {
    return Object.freeze({
      caseId: reference.caseId,
      status: "incompatible" as const,
      reason: "trial_outcomes_changed",
      metrics: Object.freeze([]),
    });
  }
  const metrics = Object.entries(reference.metrics).map(
    ([name, baselineMetric]) => {
      const current = candidate.metrics[name];
      if (current === undefined) {
        return Object.freeze({
          name,
          status: "missing" as const,
          reason: "metric_missing",
        });
      }
      if (
        current.contractFingerprint === UNVERSIONED_LOCAL_SCORER_CONTRACT ||
        baselineMetric.contractFingerprint ===
          UNVERSIONED_LOCAL_SCORER_CONTRACT ||
        current.contractFingerprint !== baselineMetric.contractFingerprint ||
        current.aggregation !== baselineMetric.aggregation
      ) {
        return Object.freeze({
          name,
          status: "incompatible" as const,
          reason: "metric_contract_changed",
        });
      }
      const baselineValue = mean(
        baselineMetric.values.map((entry) => entry.value),
      );
      const candidateValue = mean(current.values.map((entry) => entry.value));
      if (baselineValue === null || candidateValue === null) {
        return Object.freeze({
          name,
          status: "missing" as const,
          reason: "metric_value_unavailable",
        });
      }
      return Object.freeze({
        name,
        status: "compatible" as const,
        baseline: baselineValue,
        candidate: candidateValue,
        delta: candidateValue - baselineValue,
      });
    },
  );
  const status = metrics.some((metric) => metric.status === "incompatible")
    ? ("incompatible" as const)
    : metrics.some((metric) => metric.status === "missing")
      ? ("missing" as const)
      : ("compatible" as const);
  return Object.freeze({
    caseId: reference.caseId,
    status,
    metrics: Object.freeze(metrics),
  });
}

function mean(values: readonly (number | null)[]): number | null {
  const numbers = values.filter((value): value is number => value !== null);
  return numbers.length === 0
    ? null
    : numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}
