/** Canonical additive schema for committed Eval Baseline V3 truth. @internal */

import { z } from "zod";
import { BASELINE_FINGERPRINT_EPOCH } from "../../quality/internal/cache-epochs";
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
    coverage: z.array(
      z
        .object({
          caseId: z.string(),
          inputFingerprint: z.string(),
          callFingerprint: z.string(),
          expectedFingerprint: z.string(),
          trials: z.array(z.number().int().nonnegative()),
          metrics: z.record(z.string(), metric),
        })
        .passthrough(),
    ),
    skippedCases: z
      .array(
        z.object({ caseId: z.string(), reason: z.string() }).passthrough(),
      )
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
