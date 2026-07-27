/** Canonical portable schema and codec for persisted Eval V4 runs. @internal */

import { z } from "zod";
import type { EvalRun, EvalRunV3, EvalRunV4 } from "./types";
import {
  evalRunAggregateV3Schema,
  evalRunV3Schema,
  evalRunV3BaseSchema,
  incompleteEvalRunReasonsSchema,
} from "./run-schema";
import { evalCellV4Schema } from "./run-cell-v4-schema";

const count = z.number().int().nonnegative();
const aggregateV4Schema = evalRunAggregateV3Schema
  .extend({ timedOut: count })
  .superRefine((aggregate, context) => {
    if (
      aggregate.cells !==
      aggregate.passed +
        aggregate.failed +
        aggregate.errored +
        aggregate.timedOut
    ) {
      context.addIssue({
        code: "custom",
        message: "active cell aggregate is inconsistent",
      });
    }
  });
const runV4BaseSchema = evalRunV3BaseSchema.extend({
  schemaVersion: z.literal(4),
  cells: z.array(evalCellV4Schema),
  aggregates: z.record(z.string(), aggregateV4Schema),
});

/** Standard Schema-compatible authority for private Eval Run V4 records. */
export const evalRunV4Schema = z.discriminatedUnion("status", [
  runV4BaseSchema.extend({
    status: z.literal("complete"),
    passed: z.boolean(),
  }),
  runV4BaseSchema.extend({
    status: z.literal("incomplete"),
    passed: z.literal(false),
    reasons: z.array(incompleteEvalRunReasonsSchema),
  }),
]);

/** Parse a JSON-decoded value as an additive Eval V4 record. */
export function parseEvalRunV4(value: unknown): EvalRunV4 {
  return evalRunV4Schema.parse(value) as EvalRunV4;
}

/** Read retained V3 records or current V4 records by their explicit version. */
export function parseEvalRun(value: unknown): EvalRun {
  if (
    typeof value === "object" &&
    value !== null &&
    "schemaVersion" in value &&
    value.schemaVersion === 3
  ) {
    return evalRunV3Schema.parse(value) as EvalRunV3;
  }
  return parseEvalRunV4(value);
}
