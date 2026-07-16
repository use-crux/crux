/** Canonical schemas for persisted Eval V3 cell records. @internal */

import { z } from "zod";

const jsonRecord = z.record(z.string(), z.unknown());
const stringArray = z.array(z.string());
const nonnegative = z.number().finite().nonnegative();

const taskWorkSchema = z
  .object({
    status: z.enum(["executed", "reused", "errored", "skipped"]),
    reason: z.string(),
    evidenceFingerprint: z.string().optional(),
    evidenceRef: z.string().optional(),
    freshnessSource: z.string().optional(),
  })
  .passthrough();

const scoreWorkSchema = z
  .object({
    status: z.enum(["executed", "reused", "errored", "not_called"]),
    reason: z.string(),
    evidenceRef: z.string().optional(),
    reservation: z.enum(["consumed", "released"]),
  })
  .passthrough();

const scoreEvidenceSchema = z
  .object({
    status: z.enum(["computed", "errored"]),
    reason: z.string(),
    name: z.string(),
    contractFingerprint: z.string(),
    value: z.number().finite().nullable().optional(),
    label: z.string().optional(),
    rationale: z.string().optional(),
    message: z.string().optional(),
    work: scoreWorkSchema.optional(),
  })
  .passthrough();

const assertionOutcomeSchema = z
  .object({
    id: z.string(),
    level: z.enum(["evaluation", "case"]),
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
    input: jsonRecord,
    call: jsonRecord.optional(),
    output: z.unknown().optional(),
    expected: z.unknown().optional(),
    unvalidatedExpected: z.literal(true).optional(),
    response: z.record(z.string(), z.unknown()).optional(),
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
