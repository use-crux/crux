/** Canonical portable schema and codec for persisted Eval V3 runs. @internal */

import { z } from "zod";
import type { EvalRun } from "./types";
import { evalCellV3Schema } from "./run-cell-schema";
import { evalBaselineComparisonSchema } from "./baseline-comparison-schema";

const nonnegative = z.number().finite().nonnegative();
const count = z.number().int().nonnegative();

const aggregateSchema = z
  .object({
    cells: count,
    passed: count,
    failed: count,
    errored: count,
    skipped: count,
    passRate: z.number().finite().min(0).max(1),
    scores: z.record(
      z.string(),
      z
        .object({ mean: z.number().finite(), sem: nonnegative, n: count })
        .passthrough(),
    ),
    trialConsistency: z.number().finite().min(0).max(1),
    latencyMs: nonnegative,
    knownCostUsd: nonnegative.optional(),
  })
  .passthrough();

const gateSchema = z
  .object({
    passed: z.boolean(),
    blockingPassed: z.boolean(),
    results: z.array(
      z
        .object({
          gate: z.string(),
          variantName: z.string(),
          threshold: z.union([z.number().finite(), z.boolean()]),
          actual: z.union([z.number().finite(), z.boolean()]),
          passed: z.boolean(),
          informational: z.literal(true).optional(),
          evidence: z.enum(["complete", "incomplete"]).optional(),
          reason: z
            .enum(["baseline_missing", "baseline_evidence_incomplete"])
            .optional(),
          remediation: z.string().optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

const evidenceStoreSchema = z.union([
  z.literal("none"),
  z
    .object({
      identity: z.string(),
      consistency: z.enum(["read_after_write", "eventual"]),
      write: z.enum(["written", "failed", "not_eligible", "not_attempted"]),
      writeReason: z
        .enum([
          "identity_unavailable",
          "untracked_external_dependency",
          "implicit_media",
          "observed_identity_mismatch",
        ])
        .optional(),
    })
    .passthrough(),
]);

const runBase = z
  .object({
    schemaVersion: z.literal(3),
    runId: z.string().min(1),
    evalId: z.string().min(1),
    sourceKey: z
      .object({ relativeFile: z.string(), export: z.literal("default") })
      .passthrough(),
    startedAt: nonnegative,
    endedAt: nonnegative,
    definitionFingerprint: z.string(),
    selection: z
      .object({
        cases: z.array(z.string()),
        variants: z.array(z.string()),
        trials: z.number().int().positive(),
      })
      .passthrough(),
    costControl: z.enum(["not_required", "max_cost", "unknown"]),
    blockingVariants: z.array(z.string()),
    cells: z.array(evalCellV3Schema),
    variants: z.array(
      z
        .object({
          name: z.string(),
          fingerprint: z.string(),
          overrideKeys: z.array(z.string()),
          blocking: z.boolean(),
        })
        .passthrough(),
    ),
    aggregates: z.record(z.string(), aggregateSchema),
    comparison: evalBaselineComparisonSchema.optional(),
    gates: gateSchema,
    cost: z
      .object({
        actualUsd: nonnegative.optional(),
        reservedMaximumUsd: nonnegative,
        unknownActionCount: count,
        task: z.object({ actualUsd: nonnegative.optional() }).passthrough(),
        judge: z.object({ actualUsd: nonnegative.optional() }).passthrough(),
      })
      .passthrough(),
    provenance: z
      .object({
        task: z.literal("managed"),
        host: z.literal("injected"),
        evidenceStore: evidenceStoreSchema,
      })
      .passthrough(),
  })
  .passthrough();

/** Standard Schema-compatible authority for private Eval run records. */
export const evalRunV3Schema = z.discriminatedUnion("status", [
  runBase.extend({ status: z.literal("complete"), passed: z.boolean() }),
  runBase.extend({
    status: z.literal("incomplete"),
    passed: z.literal(false),
    reasons: z.array(z.enum(["task_error", "assertion_error", "scorer_error"])),
  }),
]);

/** Parse a JSON-decoded value as an additive Eval V3 record. */
export function parseEvalRunV3(value: unknown): EvalRun {
  return evalRunV3Schema.parse(value) as EvalRun;
}

/** Only complete, passing V3 runs can become Baseline truth. */
export function isEvalRunPromotable(run: EvalRun): boolean {
  return run.status === "complete" && run.passed;
}
