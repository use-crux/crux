/**
 * `@use-crux/core/eval` — inert, provider-neutral Eval authoring.
 *
 * @module
 */

export { evaluate } from "./evaluate";
export { caseFile } from "./case-file";
export { evalContext, tryEvalContext } from "./task-context";

export type { Eval, AnyEval, EvalCoverageTargetId } from "./evaluate";
export type {
  EvalCase,
  CaseOf,
  EvalCaseContext,
  EvalAssertContext,
} from "./case";
export type { CaseFile } from "./case-file";
export type { EvalTaskContext, EvalTaskTimeout } from "./task-context";
export type {
  EvalTask,
  EvalTaskLike,
  InputOf,
  OutputOf,
  CallOf,
  VariantOf,
  CapsOf,
  EvalCapability,
} from "./task";
export type {
  Scorer as EvalScorer,
  ScorerFactory as EvalScorerFactory,
} from "./internal/scorers/types";
export type { EvalGates } from "./gates";
