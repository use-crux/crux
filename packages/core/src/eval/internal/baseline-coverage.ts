/** Pure per-Case Baseline coverage projection from immutable Eval cells. @internal */

import type {
  EvalBaselineCase,
  EvalBaselineMetric,
  EvalBaselineMetricValue,
  EvalBaselineTrialOutcome,
} from "./baseline-types";
import type { EvalCellV3, EvalCellV4, EvalScorerContract } from "./cell-types";
import { fingerprintEvalValue } from "./identity";
import type { EvalRun } from "./run-types";
import type { EvalScoreEvidence } from "./score-types";

type BaselineSourceCell = EvalCellV3 | EvalCellV4;
type ComparableOutcomeStatus = Exclude<BaselineSourceCell["status"], "skipped">;
type ActiveEvalCell = BaselineSourceCell & {
  readonly status: ComparableOutcomeStatus;
};
type MetricScore = Extract<
  EvalScoreEvidence,
  { readonly value: number | null }
>;

export interface EvalCandidateTrialOutcome {
  readonly trial: number;
  readonly status: ComparableOutcomeStatus;
}

export type EvalCandidateBaselineCase = Omit<EvalBaselineCase, "outcomes"> & {
  readonly outcomes: readonly EvalCandidateTrialOutcome[];
};

/** Project complete, promotion-safe coverage for one selected Run arm. */
export function projectCompleteBaselineCoverage(
  run: EvalRun,
  arm: string,
): readonly EvalBaselineCase[] {
  const cells = run.cells.filter((cell) => cell.variant === arm);
  assertCompleteSelection(run, arm, cells);
  return projectCases(cells, arm, true).map((entry) => ({
    ...entry,
    outcomes: entry.outcomes as readonly EvalBaselineTrialOutcome[],
  }));
}

/** Project candidate coverage without claiming incomplete outcomes are promotable. */
export function projectCandidateBaselineCoverage(
  cells: readonly BaselineSourceCell[],
  arm: string,
): readonly EvalCandidateBaselineCase[] {
  return projectCases(cells, arm, false);
}

function assertCompleteSelection(
  run: EvalRun,
  arm: string,
  cells: readonly BaselineSourceCell[],
): void {
  const present = new Set(cells.map((cell) => cell.caseId));
  for (const caseId of run.selection.cases) {
    if (!present.has(caseId)) {
      throw new TypeError(`Arm '${arm}' is incomplete for Case '${caseId}'`);
    }
    const expectedTrials = run.selection.caseTrials[caseId];
    const actualTrials = sortedTrials(
      cells.filter((cell) => cell.caseId === caseId).map((cell) => cell.trial),
    );
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

function projectCases(
  cells: readonly BaselineSourceCell[],
  arm: string,
  enforceComplete: boolean,
): readonly EvalCandidateBaselineCase[] {
  const caseIds = [
    ...new Set(
      cells
        .filter((cell) => cell.variant === arm && cell.status !== "skipped")
        .map((cell) => cell.caseId),
    ),
  ];
  return Object.freeze(
    caseIds.map((caseId) => {
      const entries = cells.filter(
        (cell): cell is ActiveEvalCell =>
          cell.variant === arm &&
          cell.caseId === caseId &&
          cell.status !== "skipped",
      );
      if (
        enforceComplete &&
        entries.some((cell) => cell.status === "errored")
      ) {
        throw new TypeError(`Arm '${arm}' is incomplete for Case '${caseId}'`);
      }
      return projectCase(caseId, entries, enforceComplete);
    }),
  );
}

function projectCase(
  caseId: string,
  cells: readonly ActiveEvalCell[],
  enforceComplete: boolean,
): EvalCandidateBaselineCase {
  const first = cells[0]!;
  const ordered = [...cells].sort((left, right) => left.trial - right.trial);
  const metricNames = [
    ...new Set(
      ordered.flatMap((cell) => [
        ...scorerContracts(cell).map((contract) => contract.name),
        ...cell.scores.filter(isMetricValue).map((score) => score.name),
      ]),
    ),
  ];
  return Object.freeze({
    caseId,
    inputFingerprint: fingerprintEvalValue(first.input),
    callFingerprint: fingerprintEvalValue(first.call ?? null),
    expectedFingerprint: fingerprintEvalValue(first.expected ?? null),
    trials: Object.freeze(ordered.map((cell) => cell.trial)),
    outcomes: Object.freeze(
      ordered.map((cell) =>
        Object.freeze({ trial: cell.trial, status: cell.status }),
      ),
    ),
    metrics: Object.freeze(
      Object.fromEntries(
        metricNames.map((name) => [
          name,
          projectMetric(name, ordered, enforceComplete),
        ]),
      ),
    ),
  });
}

function projectMetric(
  name: string,
  cells: readonly ActiveEvalCell[],
  enforceComplete: boolean,
): EvalBaselineMetric {
  const scores = cells.flatMap((cell) =>
    cell.scores.filter(
      (score): score is MetricScore =>
        score.name === name && isMetricValue(score),
    ),
  );
  const contractFingerprints = [
    ...cells.flatMap((cell) =>
      scorerContracts(cell)
        .filter((contract) => contract.name === name)
        .map((contract) => contract.contractFingerprint),
    ),
    ...scores.map((score) => score.contractFingerprint),
  ];
  const contractFingerprint = contractFingerprints[0]!;
  if (
    contractFingerprints.some((candidate) => candidate !== contractFingerprint)
  ) {
    throw new TypeError(`Metric '${name}' has mixed scorer contracts`);
  }
  return Object.freeze({
    contractFingerprint,
    aggregation: "arithmetic_mean_non_null_v1",
    values: Object.freeze(
      cells
        .map((cell): EvalBaselineMetricValue | undefined => {
          if (cell.status === "timed_out") {
            return Object.freeze({ trial: cell.trial, value: null });
          }
          const score = cell.scores.find(
            (candidate): candidate is MetricScore =>
              candidate.name === name && isMetricValue(candidate),
          );
          if (score !== undefined) return metricValue(cell.trial, score);
          if (enforceComplete) {
            throw new TypeError(`Metric '${name}' is incomplete`);
          }
          return undefined;
        })
        .filter(
          (value): value is EvalBaselineMetricValue => value !== undefined,
        ),
    ),
  });
}

function scorerContracts(
  cell: BaselineSourceCell,
): readonly EvalScorerContract[] {
  return cell.scorerContracts ?? [];
}

function metricValue(
  trial: number,
  score: MetricScore,
): EvalBaselineMetricValue {
  return Object.freeze({
    trial,
    value: score.value,
    ...(score.label !== undefined ? { label: score.label } : {}),
  });
}

function isMetricValue(
  score: EvalScoreEvidence,
): score is Extract<EvalScoreEvidence, { value: number | null }> {
  return score.status === "computed" || score.status === "reused";
}

function sortedTrials(trials: readonly number[]): readonly number[] {
  return [...trials].sort((left, right) => left - right);
}
