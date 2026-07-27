/** Canonical additive schema for committed Eval Baseline V3 truth. @internal */

import { z } from "zod";
import { BASELINE_FINGERPRINT_EPOCH } from "./evidence/cache-epochs";
import type { EvalBaselineV3 } from "./baseline-types";
import { fingerprintEvalValue } from "./identity";

const metric = z
  .object({
    contractFingerprint: z.string(),
    aggregation: z.literal("arithmetic_mean_non_null_v1"),
    values: z.array(
      z
        .object({
          trial: z.number().int().nonnegative(),
          value: z.number().finite().nullable(),
          label: z.string().optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

const outcome = z
  .object({
    trial: z.number().int().nonnegative(),
    status: z.enum(["passed", "failed", "timed_out"]),
  })
  .passthrough();

const coverage = z
  .object({
    caseId: z.string(),
    inputFingerprint: z.string(),
    callFingerprint: z.string(),
    expectedFingerprint: z.string(),
    trials: z.array(z.number().int().nonnegative()),
    outcomes: z.array(outcome),
    metrics: z.record(z.string(), metric),
  })
  .passthrough()
  .superRefine((value, context) => {
    if (
      value.trials.length !== value.outcomes.length ||
      value.trials.some(
        (trial, index) => value.outcomes[index]?.trial !== trial,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["outcomes"],
        message: "must align exactly with trials",
      });
    }
    for (const [name, candidate] of Object.entries(value.metrics)) {
      if (
        candidate.values.length !== value.trials.length ||
        value.trials.some(
          (trial, index) => candidate.values[index]?.trial !== trial,
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["metrics", name, "values"],
          message: "must align exactly with trials",
        });
        continue;
      }
      candidate.values.forEach((sample, index) => {
        if (
          value.outcomes[index]?.status === "timed_out" &&
          sample.value !== null
        ) {
          context.addIssue({
            code: "custom",
            path: ["metrics", name, "values", index, "value"],
            message: "must be null for a timed-out trial",
          });
        }
      });
    }
  });

/** Standard Schema-compatible Baseline V3 authority. */
export const evalBaselineV3Schema = z
  .object({
    schemaVersion: z.literal(3),
    baselineFingerprintEpoch: z.literal(BASELINE_FINGERPRINT_EPOCH),
    baselineId: z.string().min(1),
    evalId: z.string().min(1),
    runId: z.string().min(1),
    selectedArm: z.string().min(1),
    sourceKey: z
      .object({ relativeFile: z.string(), export: z.literal("default") })
      .passthrough(),
    promotedAt: z.number().finite().nonnegative(),
    promotedBy: z.string().optional(),
    toolVersion: z.string().min(1),
    coverage: z.array(coverage),
    skippedCases: z
      .array(z.object({ caseId: z.string(), reason: z.string() }).passthrough())
      .optional(),
    provenance: z
      .object({
        definitionFingerprint: z.string(),
        taskFingerprint: z.string(),
      })
      .passthrough(),
    warnings: z
      .array(
        z
          .object({
            code: z.literal("promoted_failing_run"),
            message: z.string(),
          })
          .passthrough(),
      )
      .optional(),
    snapshotFingerprint: z.string(),
  })
  .passthrough();

export function parseEvalBaselineV3(value: unknown): EvalBaselineV3 {
  assertCurrentFingerprintEpoch(value);
  return evalBaselineV3Schema.parse(value) as EvalBaselineV3;
}

/** Parse and verify the corruption-detection fingerprint. */
export function parseAndVerifyEvalBaselineV3(value: unknown): EvalBaselineV3 {
  const baseline = parseEvalBaselineV3(value);
  const { snapshotFingerprint, ...material } = baseline;
  if (fingerprintEvalValue(material) !== snapshotFingerprint) {
    throw new TypeError("snapshot fingerprint does not match its contents");
  }
  return baseline;
}

function assertCurrentFingerprintEpoch(value: unknown): void {
  if (
    typeof value !== "object" ||
    value === null ||
    !("schemaVersion" in value) ||
    value.schemaVersion !== 3 ||
    !("baselineFingerprintEpoch" in value) ||
    value.baselineFingerprintEpoch === BASELINE_FINGERPRINT_EPOCH
  ) {
    return;
  }
  throw new TypeError(
    `Eval Baseline fingerprint epoch ${String(value.baselineFingerprintEpoch)} is incompatible; repromote with the current Crux version (expected epoch ${BASELINE_FINGERPRINT_EPOCH})`,
  );
}
