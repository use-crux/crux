/** Pure construction and granular comparison for Eval Baseline V3. @internal */

import { BASELINE_FINGERPRINT_EPOCH } from "./evidence/cache-epochs";
import { fingerprintEvalValue } from "./identity";
import type {
  EvalBaselineCase,
  EvalBaselineComparison,
  EvalBaselineDefinitionCompatibility,
  EvalBaselineMetric,
  EvalBaselineV3,
} from "./baseline-types";
import type { EvalCell, EvalRun } from "./types";
import type { AnyEval } from "../evaluate";
import { getEvalDefinitionForInternalUse } from "./definition";
import { resolveInlineCases } from "./case-matrix";
import type { Scorer } from "./scorers/types";
import {
  SCORER_IDENTITY,
  UNVERSIONED_LOCAL_SCORER_CONTRACT,
  type MaybeIdentifiedScorer,
} from "./scorers/runtime";
import { isReusableEvalValue } from "./identity";

export type { EvalBaselineComparison, EvalBaselineV3 } from "./baseline-types";

/**
 * Compare a committed Baseline with one already-discovered inert definition.
 * This is contract-only: it never invokes checks/scorers, resolves a host, or
 * reads execution evidence. Dynamic scorer factories remain explicitly unknown.
 */
export function compareEvalDefinitionToBaseline(
  evalValue: AnyEval,
  currentDefinitionFingerprint: string,
  baseline: EvalBaselineV3,
): EvalBaselineDefinitionCompatibility {
  const definition = getEvalDefinitionForInternalUse(evalValue);
  if (definition.explicitId !== baseline.evalId) {
    return Object.freeze({
      status: "incompatible" as const,
      reason: "eval_identity_changed",
      currentDefinitionFingerprint,
      baselineDefinitionFingerprint: baseline.provenance.definitionFingerprint,
      variant: Object.freeze({
        name: baseline.selectedArm,
        status: "missing" as const,
        reason: "eval_identity_changed",
      }),
      cases: Object.freeze([]),
      currentOnlyCases: Object.freeze([]),
    });
  }
  const variantFound = definition.arms.some(
    (arm) => arm.name === baseline.selectedArm,
  );
  if (hasUnprojectableImplicitCase(definition)) {
    return unprojectableCaseCompatibility(
      definition,
      currentDefinitionFingerprint,
      baseline,
      variantFound,
    );
  }
  const currentCases = resolveInlineCases(definition);
  const currentByID = new Map(
    currentCases.map((entry) => [entry.caseId, entry]),
  );
  const baselineIDs = new Set(baseline.coverage.map((entry) => entry.caseId));
  const scorerContracts = projectDefinitionScorerContracts(definition.scorers);
  const cases = baseline.coverage.map((reference) => {
    const current = currentByID.get(reference.caseId);
    if (current === undefined) {
      return Object.freeze({
        caseId: reference.caseId,
        status: "missing" as const,
        reason: "current_case_missing",
        metrics: Object.freeze([]),
      });
    }
    const authored = current.authored;
    if (!isProjectableCaseContract(authored)) {
      return Object.freeze({
        caseId: reference.caseId,
        status: "unknown" as const,
        reason: "case_contract_unprojectable",
        metrics: Object.freeze([]),
      });
    }
    const identityMatches =
      reference.inputFingerprint === fingerprintEvalValue(authored.input) &&
      reference.callFingerprint ===
        fingerprintEvalValue(authored.call ?? null) &&
      reference.expectedFingerprint ===
        fingerprintEvalValue(authored.expected ?? null) &&
      reference.trials.join(",") ===
        Array.from({ length: current.trials }, (_, trial) => trial).join(",");
    if (!identityMatches) {
      return Object.freeze({
        caseId: reference.caseId,
        status: "incompatible" as const,
        reason: "case_contract_changed",
        metrics: Object.freeze([]),
      });
    }
    const metrics = Object.entries(reference.metrics).map(([name, metric]) => {
      if (scorerContracts.status === "unknown") {
        return Object.freeze({
          name,
          status: "unknown" as const,
          reason: "scorer_contract_unprojectable",
        });
      }
      const currentContract = scorerContracts.contracts.get(name);
      if (currentContract === undefined) {
        return Object.freeze({
          name,
          status: "missing" as const,
          reason: "scorer_missing",
        });
      }
      if (currentContract === "unknown") {
        return Object.freeze({
          name,
          status: "unknown" as const,
          reason: "scorer_contract_unprojectable",
        });
      }
      return currentContract === metric.contractFingerprint
        ? Object.freeze({ name, status: "compatible" as const })
        : Object.freeze({
            name,
            status: "incompatible" as const,
            reason: "metric_contract_changed",
          });
    });
    const status = contractStatus(metrics.map((metric) => metric.status));
    return Object.freeze({
      caseId: reference.caseId,
      status,
      ...(status === "unknown"
        ? { reason: "scorer_contract_unprojectable" }
        : status === "missing"
          ? { reason: "metric_missing" }
          : status === "incompatible"
            ? { reason: "metric_contract_changed" }
            : {}),
      metrics: Object.freeze(metrics),
    });
  });
  const currentOnlyCases = Object.freeze(
    currentCases
      .filter((entry) => !entry.authored.skip && !baselineIDs.has(entry.caseId))
      .map((entry) => entry.caseId),
  );
  const hasIncompatible =
    !variantFound ||
    currentOnlyCases.length > 0 ||
    cases.some(
      (entry) => entry.status === "missing" || entry.status === "incompatible",
    );
  const hasUnknown = cases.some((entry) => entry.status === "unknown");
  const status = hasIncompatible
    ? ("incompatible" as const)
    : hasUnknown
      ? ("unknown" as const)
      : ("compatible" as const);
  const unknownReason = cases.some(
    (entry) =>
      "reason" in entry &&
      (entry as { readonly reason?: unknown }).reason ===
        "case_contract_unprojectable",
  )
    ? "case_contract_unprojectable"
    : "scorer_contract_unprojectable";
  return Object.freeze({
    status,
    ...(status === "incompatible"
      ? {
          reason: !variantFound
            ? "selected_variant_missing"
            : currentOnlyCases.length > 0
              ? "case_coverage_changed"
              : "baseline_contract_changed",
        }
      : status === "unknown"
        ? { reason: unknownReason }
        : {}),
    currentDefinitionFingerprint,
    baselineDefinitionFingerprint: baseline.provenance.definitionFingerprint,
    variant: Object.freeze({
      name: baseline.selectedArm,
      status: variantFound ? ("compatible" as const) : ("missing" as const),
      ...(!variantFound ? { reason: "selected_variant_missing" } : {}),
    }),
    cases: Object.freeze(cases),
    currentOnlyCases,
  });
}

function isProjectableCaseContract(authored: {
  readonly input: unknown;
  readonly call?: unknown;
  readonly expected?: unknown;
}): boolean {
  return (
    isReusableEvalValue(authored.input) &&
    isReusableEvalValue(authored.call ?? null) &&
    isReusableEvalValue(authored.expected ?? null)
  );
}

/**
 * Validate structural Case invariants while detecting an implicit identity
 * that cannot safely be fingerprinted. Deliberately do not catch
 * `resolveInlineCases()` errors: malformed trials and duplicate projectable
 * identities remain definition errors instead of being mislabeled unknown.
 */
function hasUnprojectableImplicitCase(
  definition: ReturnType<typeof getEvalDefinitionForInternalUse>,
): boolean {
  assertBaselineComparisonTrials(definition.trials, "Eval");
  const seen = new Map<string, number>();
  let found = false;
  definition.cases.forEach((authored, index) => {
    const trials = authored.trials ?? definition.trials;
    assertBaselineComparisonTrials(
      trials,
      authored.id === undefined
        ? `Inline Case ${index + 1}`
        : `Case '${authored.id}'`,
    );
    if (authored.id === undefined && !isReusableEvalValue(authored.input)) {
      found = true;
      return;
    }
    const caseId = authored.id ?? fingerprintEvalValue(authored.input);
    const previous = seen.get(caseId);
    if (previous !== undefined) {
      throw new TypeError(
        `planEval(): duplicate Case id '${caseId}' at inline Cases ${previous + 1} and ${index + 1}.`,
      );
    }
    seen.set(caseId, index);
  });
  return found;
}

function assertBaselineComparisonTrials(value: number, source: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${source} trials must be a positive integer.`);
  }
}

function unprojectableCaseCompatibility(
  definition: ReturnType<typeof getEvalDefinitionForInternalUse>,
  currentDefinitionFingerprint: string,
  baseline: EvalBaselineV3,
  variantFound: boolean,
): EvalBaselineDefinitionCompatibility {
  const baselineIDs = new Set(baseline.coverage.map((entry) => entry.caseId));
  const currentOnlyCases = Object.freeze(
    definition.cases
      .filter(
        (authored) =>
          !authored.skip &&
          authored.id !== undefined &&
          !baselineIDs.has(authored.id),
      )
      .map((authored) => authored.id!),
  );
  const status =
    !variantFound || currentOnlyCases.length > 0
      ? ("incompatible" as const)
      : ("unknown" as const);
  return Object.freeze({
    status,
    reason: !variantFound
      ? "selected_variant_missing"
      : currentOnlyCases.length > 0
        ? "case_coverage_changed"
        : "case_contract_unprojectable",
    currentDefinitionFingerprint,
    baselineDefinitionFingerprint: baseline.provenance.definitionFingerprint,
    variant: Object.freeze({
      name: baseline.selectedArm,
      status: variantFound ? ("compatible" as const) : ("missing" as const),
      ...(!variantFound ? { reason: "selected_variant_missing" } : {}),
    }),
    cases: Object.freeze(
      baseline.coverage.map((reference) =>
        Object.freeze({
          caseId: reference.caseId,
          status: "unknown" as const,
          reason: "case_contract_unprojectable",
          metrics: Object.freeze([]),
        }),
      ),
    ),
    currentOnlyCases,
  });
}

function projectDefinitionScorerContracts(raw: unknown):
  | {
      readonly status: "known";
      readonly contracts: ReadonlyMap<string, string>;
    }
  | { readonly status: "unknown" } {
  if (!Array.isArray(raw)) return { status: "unknown" };
  const contracts = new Map<string, string>();
  for (const candidate of raw) {
    if (typeof candidate !== "function") return { status: "unknown" };
    const scorer = candidate as Scorer<unknown, unknown, unknown>;
    const name = scorer.scorerName;
    if (typeof name !== "string" || name === "") return { status: "unknown" };
    const identity = (scorer as MaybeIdentifiedScorer)[SCORER_IDENTITY];
    contracts.set(
      name,
      isReusableEvalValue(identity) && identity !== undefined
        ? fingerprintEvalValue(identity)
        : "unknown",
    );
  }
  return { status: "known", contracts };
}

function contractStatus(
  statuses: readonly ("compatible" | "missing" | "incompatible" | "unknown")[],
) {
  return statuses.includes("incompatible")
    ? ("incompatible" as const)
    : statuses.includes("missing")
      ? ("missing" as const)
      : statuses.includes("unknown")
        ? ("unknown" as const)
        : ("compatible" as const);
}

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
  if (variant === undefined)
    throw new TypeError(`Eval run has no arm '${selectedArm}'`);
  const coverage = projectCoverage(run, selectedArm, true);
  const skippedCases = Object.freeze(
    run.cells
      .filter(
        (cell) => cell.variant === selectedArm && cell.status === "skipped",
      )
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
    baselineFingerprintEpoch: BASELINE_FINGERPRINT_EPOCH,
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
    [...byCase].map(([caseId, entries]) =>
      projectCase(caseId, entries, enforceComplete),
    ),
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
      if (score.status !== "computed" && score.status !== "reused") {
        if (enforceComplete)
          throw new TypeError(`Metric '${score.name}' is incomplete`);
        continue;
      }
      const existing = metrics.get(score.name);
      if (
        existing !== undefined &&
        existing.contractFingerprint !== score.contractFingerprint
      ) {
        throw new TypeError(
          `Metric '${score.name}' has mixed scorer contracts`,
        );
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
    trials: Object.freeze(
      cells.map((cell) => cell.trial).sort((a, b) => a - b),
    ),
    metrics: Object.freeze(Object.fromEntries(metrics)),
  });
}

function compareCase(
  reference: EvalBaselineCase,
  candidate: EvalBaselineCase | undefined,
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
  const metrics = Object.entries(reference.metrics).map(
    ([name, baselineMetric]) => {
      const current = candidate.metrics[name];
      if (current === undefined)
        return Object.freeze({
          name,
          status: "missing" as const,
          reason: "metric_missing",
        });
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
      return Object.freeze({
        name,
        status: "compatible" as const,
        baseline: baselineValue,
        candidate: candidateValue,
        delta:
          baselineValue === null || candidateValue === null
            ? null
            : candidateValue - baselineValue,
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
