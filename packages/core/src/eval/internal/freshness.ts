/** Pure declaration-only freshness policy for one planned Eval cell. @internal */

import type { EvalDefinitionV1, RawEvalCase } from "./definition";
import type { EvalFreshnessSource } from "./types";

export interface EvalCellFreshness {
  readonly reason?: "fresh_requested" | "performance_freshness";
  readonly source?: EvalFreshnessSource;
}

/** Resolve run, Gate, Eval, and Case freshness without inspecting callbacks. */
export function resolveEvalCellFreshness(
  definition: EvalDefinitionV1,
  authored: RawEvalCase,
  freshRequested: boolean,
): EvalCellFreshness {
  if (freshRequested) return Object.freeze({ reason: "fresh_requested" });
  const source = hasPerformanceGate(definition.gates)
    ? ("latency_gate" as const)
    : definition.expect?.requiresFresh
      ? ("eval_expect" as const)
      : definition.afterScores?.requiresFresh
        ? ("eval_after_scores" as const)
        : authored.expect?.requiresFresh
          ? ("case_expect" as const)
          : authored.afterScores?.requiresFresh
            ? ("case_after_scores" as const)
            : undefined;
  return source === undefined
    ? Object.freeze({})
    : Object.freeze({ reason: "performance_freshness", source });
}

function hasPerformanceGate(gates: EvalDefinitionV1["gates"]): boolean {
  return gates?.latency !== undefined;
}
