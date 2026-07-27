/** Pure construction of privacy-safe Eval Baseline V3 snapshots. @internal */

import type { EvalBaselineV3 } from "./baseline-types";
import { projectCompleteBaselineCoverage } from "./baseline-coverage";
import { BASELINE_FINGERPRINT_EPOCH } from "./evidence/cache-epochs";
import { fingerprintEvalValue } from "./identity";
import type { EvalRun } from "./run-types";

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
  if (variant === undefined) {
    throw new TypeError(`Eval run has no arm '${selectedArm}'`);
  }
  const coverage = projectCompleteBaselineCoverage(run, selectedArm);
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
  } satisfies Omit<EvalBaselineV3, "snapshotFingerprint">;
  return Object.freeze({
    ...material,
    snapshotFingerprint: fingerprintEvalValue(material),
  });
}
