/** Pure admitted contract projection shared by planning and score evidence. */

import { fingerprintEvalValue, isReusableEvalValue } from "./identity";
import {
  SCORER_IDENTITY,
  UNVERSIONED_LOCAL_SCORER_CONTRACT,
  type MaybeIdentifiedScorer,
} from "./scorers/runtime";
import type { Scorer } from "./scorers/types";

/** Stable admitted name used before a scorer produces runtime evidence. */
export function scorerContractName(
  scorer: Scorer<unknown, unknown, unknown>,
): string {
  return scorer.scorerName ?? scorer.name ?? "(dynamic)";
}

/** Project the contract used by deterministic local score evidence. */
export function deterministicScorerContract(
  scorer: Scorer<unknown, unknown, unknown>,
): string {
  const identity = (scorer as MaybeIdentifiedScorer)[SCORER_IDENTITY];
  return identity !== undefined && isReusableEvalValue(identity)
    ? fingerprintEvalValue(identity)
    : UNVERSIONED_LOCAL_SCORER_CONTRACT;
}
