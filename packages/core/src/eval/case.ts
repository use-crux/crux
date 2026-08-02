/**
 * Inline Eval Case types.
 *
 * A Case describes input and expected evidence. It never executes its task;
 * execution belongs to the later portable Eval kernel.
 *
 * @module
 */

import type { JsonValue } from "../storage";
import type { TimeoutOptions } from "../generation/timeout";
import type {
  AlwaysOnExpect,
  AssertContext,
  CaseContext,
  SignalExpect,
  StepAccess,
  ValueExpect,
} from "./internal/assertions/types";
import type { StandardSchemaV1 } from "../internal/standard-schema";
import type {
  CapsOf,
  EvalCaseCallOf,
  EvalCapability,
  EvalTaskLike,
  InputOf,
  OutputOf,
  ResponseOf,
  RequiredKeys,
} from "./task";

/** Adds a normalized response only for a managed task. @internal */
type EvalResponseProjection<Response> = [Response] extends [never]
  ? object
  : { readonly response: Response };

/** Value/non-timing assertion surface available to ordinary Eval callbacks. */
type EvalBoundExpect<O, Caps extends EvalCapability> = ValueExpect &
  Pick<AlwaysOnExpect, "cost" | "errors"> &
  Pick<SignalExpect, Extract<Caps, keyof SignalExpect>>;

/** Step accessor that deliberately omits timing evidence. @internal */
interface EvalStepAccessor {
  (name: string): Omit<StepAccess<unknown>, "durationMs">;
  <S extends StandardSchemaV1>(
    name: string,
    schema: S,
  ): Omit<StepAccess<StandardSchemaV1.InferOutput<S>>, "durationMs">;
}

/** Cache-friendly Eval callback context without official timing evidence. */
export type EvalCaseContext<
  I,
  O,
  E,
  Caps extends EvalCapability,
  Response = never,
> = Omit<CaseContext<I, O, E, Caps>, "expect" | "meta" | "step"> &
  EvalResponseProjection<Response> & {
    expect: EvalBoundExpect<O, Caps>;
    meta: Omit<CaseContext<I, O, E, Caps>["meta"], "durationMs">;
    step: "steps" extends Caps ? EvalStepAccessor : never;
  };

/** Live-only context exposed by a declared fresh callback. @internal */
type EvalFreshCaseContext<
  I,
  O,
  E,
  Caps extends EvalCapability,
  Response,
> = CaseContext<I, O, E, Caps> & EvalResponseProjection<Response>;

/** Existing post-score context exposed under Eval vocabulary during coexistence. */
export type EvalAssertContext<
  I,
  O,
  E,
  ScoreName extends string,
  Caps extends EvalCapability,
  Response = never,
> = Omit<AssertContext<I, O, E, ScoreName, Caps>, "expect" | "meta" | "step"> &
  EvalResponseProjection<Response> & {
    expect: EvalBoundExpect<O, Caps>;
    meta: Omit<AssertContext<I, O, E, ScoreName, Caps>["meta"], "durationMs">;
    step: "steps" extends Caps ? EvalStepAccessor : never;
  };

/** Live-only score-aware context exposed by a fresh callback. @internal */
type EvalFreshAssertContext<
  I,
  O,
  E,
  ScoreName extends string,
  Caps extends EvalCapability,
  Response,
> = AssertContext<I, O, E, ScoreName, Caps> & EvalResponseProjection<Response>;

/** Ordinary callback or explicitly live timing callback. @internal */
export type EvalCheck<TContext, TFreshContext> =
  | ((context: TContext) => void | Promise<void>)
  | {
      readonly fresh: true;
      readonly check: (context: TFreshContext) => void | Promise<void>;
    };

/**
 * Shared fields for one typed Case, excluding call-arity handling.
 *
 * @typeParam I - Input derived from the task.
 * @typeParam O - Semantic task output.
 * @typeParam E - Expected evidence inferred from inline Cases.
 * @typeParam Caps - Captured trace-signal capabilities.
 * @typeParam ScoreName - Statically known scorer names.
 */
interface EvalCaseFields<
  I,
  O,
  E,
  Caps extends EvalCapability,
  ScoreName extends string = string,
  Response = never,
> {
  id?: string;
  name?: string;
  input: NoInfer<I>;
  expected?: E;
  expect?: EvalCheck<
    EvalCaseContext<I, O, NoInfer<E>, Caps, Response>,
    EvalFreshCaseContext<I, O, NoInfer<E>, Caps, Response>
  >;
  afterScores?: EvalCheck<
    EvalAssertContext<I, O, NoInfer<E>, ScoreName, Caps, Response>,
    EvalFreshAssertContext<I, O, NoInfer<E>, ScoreName, Caps, Response>
  >;
  /**
   * Per-Case structured timeout overrides.
   *
   * Missing fields inherit the Eval policy, fields and named Tools replace
   * inherited values, and `null` explicitly clears an inherited ceiling.
   * Set `timeout` itself to `null` to clear every inherited timeout.
   *
   * @defaultValue `undefined`
   *
   * @example
   * ```ts
   * import type { CaseOf } from '@use-crux/core/eval'
   * import { support } from '../src/support'
   *
   * const cases = [
   *   { input: { question: 'standard' }, timeout: { toolMs: 2_000 } },
   *   { input: { question: 'unbounded' }, timeout: null },
   * ] satisfies readonly CaseOf<typeof support>[]
   * ```
   */
  readonly timeout?: TimeoutOptions | null;
  trials?: number;
  tags?: readonly string[];
  metadata?: Readonly<Record<string, JsonValue>>;
  only?: boolean;
  skip?: boolean | string;
}

/** Case-level call options follow the callable task's required-key arity. */
type EvalCaseCall<C extends object> = [RequiredKeys<C>] extends [never]
  ? { call?: NoInfer<C> }
  : { call: NoInfer<C> };

/**
 * One typed input and its optional expected evidence and checks.
 *
 * `call` becomes required when task defaults leave any required call option
 * unbound, keeping authored Cases executable through every Variant arm.
 */
export type EvalCase<
  I,
  O,
  E,
  C extends object,
  Caps extends EvalCapability,
  ScoreName extends string = string,
  Response = never,
> = EvalCaseFields<I, O, E, Caps, ScoreName, Response> & EvalCaseCall<C>;

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
> = EvalCase<
  InputOf<T>,
  OutputOf<T>,
  E,
  EvalCaseCallOf<T>,
  CapsOf<T>,
  ScoreName,
  ResponseOf<T>
>;
