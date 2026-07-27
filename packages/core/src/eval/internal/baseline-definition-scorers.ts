/** Pure scorer-contract projection for inert Baseline compatibility. @internal */

import { fingerprintEvalValue, isReusableEvalValue } from "./identity";
import { SCORER_IDENTITY, type MaybeIdentifiedScorer } from "./scorers/runtime";
import type { Scorer } from "./scorers/types";

export type BaselineContractStatus =
  | "compatible"
  | "missing"
  | "incompatible"
  | "unknown";

/** Project scorer identities without executing dynamic scorer factories. */
export function projectDefinitionScorerContracts(raw: unknown):
  | {
      readonly status: "known";
      readonly contracts: ReadonlyMap<string, string>;
    }
  | { readonly status: "unknown" } {
  if (!Array.isArray(raw)) return { status: "unknown" };
  const entries = raw.map((candidate) => projectScorerContract(candidate));
  if (entries.some((entry) => entry === undefined)) {
    return { status: "unknown" };
  }
  return {
    status: "known",
    contracts: new Map(
      entries.filter(
        (entry): entry is readonly [string, string] => entry !== undefined,
      ),
    ),
  };
}

/** Collapse metric-level compatibility using conservative precedence. */
export function contractStatus(
  statuses: readonly BaselineContractStatus[],
): BaselineContractStatus {
  return statuses.includes("incompatible")
    ? "incompatible"
    : statuses.includes("missing")
      ? "missing"
      : statuses.includes("unknown")
        ? "unknown"
        : "compatible";
}

function projectScorerContract(
  candidate: unknown,
): readonly [string, string] | undefined {
  if (typeof candidate !== "function") return undefined;
  const scorer = candidate as Scorer<unknown, unknown, unknown>;
  const name = scorer.scorerName;
  if (typeof name !== "string" || name === "") return undefined;
  const identity = (scorer as MaybeIdentifiedScorer)[SCORER_IDENTITY];
  return [
    name,
    isReusableEvalValue(identity) && identity !== undefined
      ? fingerprintEvalValue(identity)
      : "unknown",
  ];
}
