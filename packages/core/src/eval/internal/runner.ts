/**
 * Project-local tooling bridge for the Eval coordinator.
 *
 * This subpath is intentionally internal. It lets the extracted coordinator
 * inspect and re-materialize Evals through the same Core module instance used
 * by project source without widening `@use-crux/core/eval`.
 *
 * @internal
 * @module
 */

import type { AnyEval } from "../evaluate";
import {
  EVAL_INTERNAL,
  getEvalDefinitionForInternalUse,
  type EvalDefinitionV1,
  type RawEvalCase,
} from "./definition";
import {
  getEvalTaskDescriptorForInternalUse,
  isManagedEvalTaskForInternalUse,
} from "./task";
import { fingerprintEvalValue } from "./identity";

export { planEval } from "./planner";
export { executeEvalPlan } from "./executor";
export { compareEvalDefinitionToBaseline } from "./baseline";
export {
  executeEvalTaskForInternalUse,
  fingerprintManagedEvalTaskForInternalUse,
  getEvalTaskDescriptorForInternalUse,
  isManagedEvalTaskForInternalUse,
} from "./task";
export { executeObservedEvalTaskForInternalUse } from "./observed-task";
export {
  fingerprintEvalPersistencePolicy,
  normalizeEvalPersistencePolicy,
} from "./redact";
export {
  projectResolvedEvalTimeoutPolicy,
  resolveEvalTimeoutPolicy,
} from "../timeout-policy";
export type { EvalPersistencePolicy } from "./redact";
export type {
  EvalExecutionPorts,
  EvalPlanningPorts,
  ExternalScorerHostRequest,
} from "./ports";
export type { EvalPlan, EvalRun, EvalTaskHostRequest } from "./types";

/** Worker/Core compatibility marker checked before project discovery. */
export const EVAL_RUNNER_PROTOCOL = 1 as const;

/** Return whether a module export is an Eval authored by this Core contract. */
export function isEvalForInternalUse(value: unknown): value is AnyEval {
  return (
    value !== null &&
    typeof value === "object" &&
    "_tag" in value &&
    value._tag === "CruxEval"
  );
}

export { getEvalDefinitionForInternalUse };
export type { AnyEval, EvalDefinitionV1, RawEvalCase };

/** Canonical Case-input fingerprint used when an explicit id is absent. */
export function fingerprintEvalValueForInternalUse(value: unknown): string {
  return fingerprintEvalValue(value);
}

/** Read the managed task schemas required by file-backed Case validation. */
export function getEvalTaskSchemasForInternalUse(evalValue: AnyEval): {
  readonly inputSchema: ReturnType<
    typeof getEvalTaskDescriptorForInternalUse
  >["inputSchema"];
  readonly outputSchema: ReturnType<
    typeof getEvalTaskDescriptorForInternalUse
  >["outputSchema"];
} {
  const task = getEvalDefinitionForInternalUse(evalValue).task;
  if (!isManagedEvalTaskForInternalUse(task)) {
    return Object.freeze({ inputSchema: undefined, outputSchema: undefined });
  }
  const descriptor = getEvalTaskDescriptorForInternalUse(task);
  return Object.freeze({
    inputSchema: descriptor.inputSchema,
    outputSchema: descriptor.outputSchema,
  });
}

/**
 * Create a coordinator-owned Eval shell with discovered identity and Cases.
 * User-owned task, schemas, scorers, callbacks, and Case values stay by
 * reference; only Crux-owned records and arrays are copied and frozen.
 */
export function materializeEvalForInternalUse(
  evalValue: AnyEval,
  input: { readonly id: string; readonly cases: readonly RawEvalCase[] },
): AnyEval {
  const authored = getEvalDefinitionForInternalUse(evalValue);
  const definition: EvalDefinitionV1 = Object.freeze({
    ...authored,
    explicitId: input.id,
    cases: Object.freeze([...input.cases]),
    caseFiles: Object.freeze([]),
    caseSourceOrder: Object.freeze(
      input.cases.map((_, index) =>
        Object.freeze({ kind: "inline" as const, index }),
      ),
    ),
  });
  const materialized = { _tag: "CruxEval" as const, id: input.id };
  Object.defineProperty(materialized, EVAL_INTERNAL, {
    value: definition,
    enumerable: false,
  });
  return Object.freeze(materialized) as AnyEval;
}
