import { expectTypeOf } from "vitest";
import type { AnyEval, Eval } from "@use-crux/core/eval";
import {
  runEval,
  type EvalPlan,
  type EvalRun,
  type RunEvalOptions,
} from "@use-crux/core/eval/node";

declare const evalValue: AnyEval;

expectTypeOf(runEval("support")).toEqualTypeOf<Promise<EvalRun>>();
expectTypeOf(runEval(evalValue)).toEqualTypeOf<Promise<EvalRun>>();
expectTypeOf(runEval("support", { plan: true })).toEqualTypeOf<Promise<EvalPlan>>();
expectTypeOf(runEval(evalValue, { plan: true })).toEqualTypeOf<Promise<EvalPlan>>();

const options: RunEvalOptions = {
  case: ["refund", "shipping*"],
  variant: "candidate",
  fresh: true,
  offline: true,
  maxCostUsd: 1,
};
void options;
expectTypeOf(runEval("support", options)).toEqualTypeOf<
  Promise<EvalPlan | EvalRun>
>();

// @ts-expect-error — plan must be the literal true to select the plan overload
runEval("support", { plan: "yes" });
// @ts-expect-error — runtime id overrides are not part of the Node API
runEval(evalValue, { id: "override" });

declare const typedEval: Eval<
  { question: string },
  string,
  "pass" | "helpful",
  "candidate",
  "support"
>;
expectTypeOf(runEval(typedEval, { variant: "candidate" })).toEqualTypeOf<
  Promise<EvalRun<"pass" | "helpful", "candidate">>
>();
// @ts-expect-error — object form preserves authored Variant names
runEval(typedEval, { variant: "missing" });

declare const typedRun: EvalRun<"pass" | "helpful", "candidate">;
expectTypeOf(typedRun.aggregates.current).toEqualTypeOf<
  | import("@use-crux/core/eval/node").EvalVariantAggregate<
      "pass" | "helpful"
    >
  | undefined
>();
expectTypeOf(typedRun.aggregates.candidate).toEqualTypeOf<
  import("@use-crux/core/eval/node").EvalVariantAggregate<
    "pass" | "helpful"
  > | undefined
>();
if (typedRun.aggregates.current !== undefined) {
  expectTypeOf(
    typedRun.aggregates.current.scores.helpful,
  ).toEqualTypeOf<
    | { readonly mean: number; readonly sem: number; readonly n: number }
    | undefined
  >();
  // @ts-expect-error — scorer literals remain exact
  typedRun.aggregates.current.scores.unknown;
}
