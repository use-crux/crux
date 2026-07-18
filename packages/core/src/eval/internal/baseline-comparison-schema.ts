/** Canonical nested schema for a run's granular Baseline comparison. @internal */

import { z } from "zod";

const metric = z.discriminatedUnion("status", [
  z
    .object({
      name: z.string(),
      status: z.literal("compatible"),
      baseline: z.number().finite().nullable(),
      candidate: z.number().finite().nullable(),
      delta: z.number().finite().nullable(),
    })
    .passthrough(),
  z
    .object({
      name: z.string(),
      status: z.enum(["missing", "incompatible"]),
      reason: z.string(),
    })
    .passthrough(),
]);

export const evalBaselineComparisonSchema = z
  .object({
    baselineId: z.string(),
    baselineRunId: z.string(),
    selectedArm: z.string(),
    cases: z.array(
      z
        .object({
          caseId: z.string(),
          status: z.enum(["compatible", "missing", "incompatible"]),
          reason: z.string().optional(),
          metrics: z.array(metric),
        })
        .passthrough(),
    ),
    unmatchedCases: z
      .object({
        baselineOnly: z.array(z.string()),
        candidateOnly: z.array(z.string()),
      })
      .passthrough(),
  })
  .passthrough();
