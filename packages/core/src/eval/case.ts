/**
 * Inline Eval Case types.
 *
 * A Case describes input and expected evidence. It never executes its task;
 * execution belongs to the later portable Eval kernel.
 *
 * @module
 */

import type { JsonValue } from "../storage";
import type { AssertContext, CaseContext } from "../quality/expect";
import type {
  CallOf,
  CapsOf,
  EvalCapability,
  EvalTaskLike,
  InputOf,
  OutputOf,
} from "./task";

/** Existing assertion context exposed under Eval vocabulary during coexistence. */
export type EvalCaseContext<I, O, E, Caps extends EvalCapability> = CaseContext<
  I,
  O,
  E,
  Caps
>;

/** Existing post-score context exposed under Eval vocabulary during coexistence. */
export type EvalAssertContext<
  I,
  O,
  E,
  ScoreName extends string,
  Caps extends EvalCapability,
> = AssertContext<I, O, E, ScoreName, Caps>;

/**
 * One typed input and its optional expected evidence and checks.
 *
 * @typeParam I - Input derived from the task.
 * @typeParam O - Semantic task output.
 * @typeParam E - Expected evidence inferred from inline Cases.
 * @typeParam C - Remaining task call options.
 * @typeParam Caps - Captured trace-signal capabilities.
 * @typeParam ScoreName - Statically known scorer names.
 */
export interface EvalCase<
  I,
  O,
  E,
  C extends object,
  Caps extends EvalCapability,
  ScoreName extends string = string,
> {
  id?: string;
  name?: string;
  input: NoInfer<I>;
  call?: NoInfer<C>;
  expected?: E;
  expect?: (
    ctx: EvalCaseContext<I, O, NoInfer<E>, Caps>,
  ) => void | Promise<void>;
  afterScores?: (
    ctx: EvalAssertContext<I, O, NoInfer<E>, ScoreName, Caps>,
  ) => void | Promise<void>;
  trials?: number;
  tags?: readonly string[];
  metadata?: Readonly<Record<string, JsonValue>>;
  only?: boolean;
  skip?: boolean | string;
}

/**
 * The Case type derived from a task.
 *
 * Use this as the annotation escape hatch when Cases live outside the Eval
 * definition and therefore lose contextual typing.
 */
export type CaseOf<
  T extends EvalTaskLike,
  E = unknown,
  ScoreName extends string = string,
> = EvalCase<InputOf<T>, OutputOf<T>, E, CallOf<T>, CapsOf<T>, ScoreName>;
