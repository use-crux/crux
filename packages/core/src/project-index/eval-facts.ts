/**
 * Project Index facts for runtime-discovered Eval definitions.
 *
 * @module
 */

import type { AnyEval } from "../eval/evaluate";
import { getEvalDefinitionForInternalUse } from "../eval/internal/definition";
import {
  normalizeEvalTimeoutPolicy,
  projectResolvedEvalTimeoutPolicy,
  resolveEvalTimeoutPolicy,
} from "../eval/timeout-policy";

/**
 * Canonical, JSON-safe Eval timeout policy data.
 *
 * @remarks
 * Field names match Eval authoring. Missing fields remain absent and explicit
 * disabled budgets remain `null`.
 */
export type EvalTimeoutPolicyData = Readonly<{
  readonly totalMs?: number | null;
  readonly stepMs?: number | null;
  readonly chunkMs?: number | null;
  readonly firstToken?: number | null;
  readonly toolMs?: number | null;
  readonly tools?: Readonly<Record<string, number | null>>;
}>;

/**
 * Authored and effective timeout policy shown by Project Index consumers.
 *
 * @remarks
 * A missing `authored` field means inheritance, while `authored: null` means
 * an explicit whole-policy clear. `effective` never contains Core's private
 * Eval ceiling marker.
 */
export type EvalTimeoutPolicyProjection = Readonly<{
  readonly authored?: EvalTimeoutPolicyData | null;
  readonly effective: EvalTimeoutPolicyData;
}>;

/** Runtime-rich Project Index facts for an Eval definition. */
export interface EvalFacts {
  readonly kind: "eval" | "eval.case";
  readonly targetDefinitionId?: string;
  readonly evalId?: string;
  readonly caseCount?: number;
  readonly scorerIds?: readonly string[];
  /** Canonical Eval-level timeout policy, omitted when no policy was authored. */
  readonly timeout?: EvalTimeoutPolicyProjection;
}

/**
 * Project one inert Eval's canonical timeout policy for Project Index.
 *
 * @param evalValue - Inert Eval returned by `evaluate()`.
 * @returns Immutable authored/effective policy data, or `undefined` when both
 *   are absent and empty.
 * @internal
 */
export function projectEvalTimeoutPolicyForInternalUse(
  evalValue: AnyEval,
): EvalTimeoutPolicyProjection | undefined {
  const definition = getEvalDefinitionForInternalUse(evalValue);
  const authored = normalizeEvalTimeoutPolicy(
    definition.timeout,
    "Eval timeout",
  );
  const effective = projectResolvedEvalTimeoutPolicy(
    resolveEvalTimeoutPolicy(undefined, authored),
  );

  if (authored === undefined && Object.keys(effective).length === 0) {
    return undefined;
  }

  return Object.freeze({
    ...(authored === undefined ? {} : { authored }),
    effective,
  });
}
