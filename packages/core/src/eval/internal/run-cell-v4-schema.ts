/** Version-specific persisted Eval V4 cell schema. @internal */

import { z } from "zod";
import { evalCellV3Schema } from "./run-cell-schema";

const absent = z.never().optional();
const timedOutTaskSchema = z
  .object({
    status: z.literal("timed_out"),
    reason: absent,
    evidenceFingerprint: absent,
    evidenceRef: absent,
    freshnessSource: absent,
  })
  .passthrough();
const timeoutSchema = z
  .object({
    budget: z.enum(["total", "step", "chunk", "firstToken", "tool"]),
    limitMs: z.number().finite().positive(),
    toolName: z.string().min(1).optional(),
  })
  .passthrough();
const scorerContractSchema = z
  .object({
    name: z.string().min(1),
    contractFingerprint: z.string().min(1),
  })
  .passthrough();

/** Canonical additive Eval V4 cell schema with structured timeout evidence. */
export const evalCellV4Schema = evalCellV3Schema
  .extend({
    status: z.enum(["passed", "failed", "errored", "skipped", "timed_out"]),
    task: z.union([evalCellV3Schema.shape.task, timedOutTaskSchema]),
    timeout: timeoutSchema.optional(),
    scorerContracts: z.array(scorerContractSchema),
  })
  .superRefine((cell, context) => {
    const timedOut = cell.status === "timed_out";
    if (
      timedOut !==
        (cell.task.status === "timed_out" && cell.timeout !== undefined) ||
      (timedOut && cell.error !== undefined) ||
      (cell.timeout !== undefined &&
        (cell.timeout.budget === "tool") !==
          (cell.timeout.toolName !== undefined))
    ) {
      context.addIssue({
        code: "custom",
        message: "timed-out cell fields are inconsistent",
      });
    }
  });
