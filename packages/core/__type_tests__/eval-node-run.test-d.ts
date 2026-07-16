import { expectTypeOf } from "vitest";
import type { AnyEval } from "@use-crux/core/eval";
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
