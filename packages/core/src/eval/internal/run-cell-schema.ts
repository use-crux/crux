/** Canonical schemas for persisted Eval V3 cell records. @internal */

import { z } from "zod";

const jsonRecord = z.record(z.string(), z.unknown());
const stringArray = z.array(z.string());
const nonnegative = z.number().finite().nonnegative();

const absent = z.never().optional();
const taskWorkSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("executed"),
      reason: z.enum([
        "live_required",
        "fresh_requested",
        "performance_freshness",
        "no_exact_evidence",
        "identity_unavailable",
        "model_identity_unattested",
        "untracked_external_dependency",
        "nondeterministic_renderer",
        "task_binding_untracked",
        "unresolved_source_dependency",
        "implicit_media",
        "registry_identity_unavailable",
        "host_contract_unavailable",
      ]),
      evidenceFingerprint: z.string().optional(),
      evidenceRef: z.string().optional(),
      freshnessSource: z.string().optional(),
    })
    .passthrough(),
  z
    .object({
      status: z.literal("reused"),
      reason: z.literal("exact_evidence"),
      evidenceFingerprint: z.string(),
      evidenceRef: z.string(),
      freshnessSource: absent,
    })
    .passthrough(),
  z
    .object({
      status: z.literal("errored"),
      reason: z.literal("task_error"),
      evidenceFingerprint: absent,
      evidenceRef: absent,
      freshnessSource: absent,
    })
    .passthrough(),
  z
    .object({
      status: z.literal("skipped"),
      reason: z.literal("source_skipped"),
      evidenceFingerprint: absent,
      evidenceRef: absent,
      freshnessSource: absent,
    })
    .passthrough(),
]);

const scoreValue = z.number().finite().min(0).max(1).nullable();
const tokenUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    inputTokenDetails: z
      .object({
        cacheReadTokens: z.number().int().nonnegative().optional(),
        cacheWriteTokens: z.number().int().nonnegative().optional(),
      })
      .passthrough(),
    outputTokenDetails: z
      .object({ reasoningTokens: z.number().int().nonnegative().optional() })
      .passthrough(),
  })
  .passthrough();
const managedScoreMetrics = z
  .object({
    actualUsd: nonnegative.optional(),
    usage: tokenUsageSchema.optional(),
  })
  .refine(
    (value) => value.actualUsd !== undefined || value.usage !== undefined,
    "managed scorer metrics must contain cost or usage",
  )
  .optional();
const scoreBase = {
  name: z.string().min(1),
  label: z.string().optional(),
  rationale: z.string().optional(),
};
const managedExecutedWork = z
  .object({
    status: z.literal("executed"),
    reason: z.enum([
      "fresh_requested",
      "performance_freshness",
      "no_exact_evidence",
      "identity_unavailable",
      "exact_evidence",
    ]),
    evidenceRef: z.string().optional(),
    reservation: z.literal("consumed"),
  })
  .passthrough();
const managedReusedWork = z
  .object({
    status: z.literal("reused"),
    reason: z.literal("exact_evidence"),
    evidenceRef: z.string().optional(),
    reservation: z.literal("released"),
  })
  .passthrough();
const managedErrorWork = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("errored"),
      reason: z.literal("scorer_error"),
      reservation: z.literal("consumed"),
      evidenceRef: absent,
    })
    .passthrough(),
  z
    .object({
      status: z.literal("not_called"),
      reason: z.literal("scorer_error"),
      reservation: z.literal("released"),
      evidenceRef: absent,
    })
    .passthrough(),
]);
const scoreEvidenceSchema = z.union([
  z
    .object({
      status: z.literal("computed"),
      reason: z.literal("deterministic_local"),
      ...scoreBase,
      contractFingerprint: z.string(),
      value: scoreValue,
      message: absent,
      metrics: absent,
      work: absent,
    })
    .passthrough(),
  z
    .object({
      status: z.literal("computed"),
      reason: z.literal("managed_external_executed"),
      ...scoreBase,
      contractFingerprint: z.string().min(1),
      value: scoreValue,
      message: absent,
      metrics: managedScoreMetrics,
      work: managedExecutedWork,
    })
    .passthrough(),
  z
    .object({
      status: z.literal("reused"),
      reason: z.literal("managed_external_reused"),
      ...scoreBase,
      contractFingerprint: z.string().min(1),
      value: scoreValue,
      message: absent,
      metrics: absent,
      work: managedReusedWork,
    })
    .passthrough(),
  z
    .object({
      status: z.literal("missing"),
      reason: z.literal("dependency_failed"),
      name: z.string().min(1),
      contractFingerprint: z.string().min(1),
      value: absent,
      label: absent,
      rationale: absent,
      message: z.string(),
      metrics: absent,
      work: z
        .object({
          status: z.literal("not_called"),
          reason: z.literal("dependency_failed"),
          reservation: z.literal("released"),
          evidenceRef: absent,
        })
        .passthrough(),
    })
    .passthrough(),
  z
    .object({
      status: z.literal("errored"),
      reason: z.literal("scorer_error"),
      name: z.string().min(1),
      contractFingerprint: z.string(),
      value: absent,
      label: absent,
      rationale: absent,
      message: z.string(),
      metrics: absent,
      work: absent,
    })
    .passthrough(),
  z
    .object({
      status: z.literal("errored"),
      reason: z.literal("scorer_error"),
      name: z.string().min(1),
      contractFingerprint: z.string().min(1),
      value: absent,
      label: absent,
      rationale: absent,
      message: z.string(),
      metrics: absent,
      work: managedErrorWork,
    })
    .passthrough(),
]);

const assertionOutcomeSchema = z
  .object({
    id: z.string(),
    level: z.enum(["eval", "case"]),
    phase: z.enum(["expect", "afterScores"]),
    index: z.number().int().nonnegative(),
    status: z.enum(["passed", "failed", "not-evaluated", "uncaptured"]),
    matcher: z.string(),
    soft: z.boolean(),
  })
  .passthrough();

/** Canonical additive Eval V3 cell schema. */
export const evalCellV3Schema = z
  .object({
    caseId: z.string(),
    caseName: z.string().optional(),
    variant: z.string(),
    trial: z.number().int().nonnegative(),
    status: z.enum(["passed", "failed", "errored", "skipped"]),
    skipReason: z.string().optional(),
    task: taskWorkSchema,
    scores: z.array(scoreEvidenceSchema),
    assertions: z
      .object({
        ran: z.number().int().nonnegative(),
        notEvaluated: z.number().int().nonnegative(),
        outcomes: z.array(assertionOutcomeSchema),
      })
      .passthrough(),
    input: z.unknown(),
    call: jsonRecord.optional(),
    output: z.unknown().optional(),
    expected: z.unknown().optional(),
    unvalidatedExpected: z.literal(true).optional(),
    response: z.record(z.string(), z.unknown()).optional(),
    responseOmitted: z
      .enum(["persistence_size_limit", "persistence_unsafe"])
      .optional(),
    error: z
      .object({
        message: z.string(),
        phase: z.enum(["execute", "expect", "afterScores", "score"]),
      })
      .passthrough()
      .optional(),
    metrics: z
      .object({ durationMs: nonnegative, costUsd: nonnegative.optional() })
      .passthrough(),
    runIds: stringArray,
    capturedSignals: stringArray,
  })
  .passthrough();
