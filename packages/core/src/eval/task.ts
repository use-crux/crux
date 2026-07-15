/**
 * Provider-neutral task types used by Eval authoring.
 *
 * Managed task implementations attach their private execution descriptors in
 * provider packages. Core carries only the callable contract and inference
 * metadata, keeping `@use-crux/core/eval` portable.
 *
 * @module
 */

import type { Capability } from "../quality/target";

/** A trace-signal family that an Eval task can capture. */
export type EvalCapability = Capability;

declare const EVAL_TASK_TYPES: unique symbol;

/** Required property names in an authored call-options object. @internal */
export type RequiredKeys<C extends object> = {
  [K in keyof C]-?: object extends Pick<C, K> ? never : K;
}[keyof C];

/** Callable arguments after task defaults have been applied. @internal */
type TaskArgs<I, C extends object> = [RequiredKeys<C>] extends [never]
  ? [input: I, call?: C]
  : [input: I, call: C];

/** Isolates callable tuple selection from the public variance carrier. @internal */
interface EvalTaskCallable<I, R, C extends object> {
  (...args: TaskArgs<I, C>): Promise<R>;
}

/** Type-only descriptor with explicit compatibility variance. @internal */
interface EvalTaskTypes<
  in I,
  out R,
  out O,
  in C extends object,
  in V extends object,
  out Caps extends EvalCapability,
> {
  readonly _tag: "CruxTask";
  readonly operation: "generate" | "stream" | "function" | "flow" | "agent";
  readonly [EVAL_TASK_TYPES]?: {
    input: (value: I) => void;
    productionResult: () => R;
    evalOutput: () => O;
    call: (value: C) => void;
    variant: (value: V) => void;
    capabilities: () => Caps;
  };
}

/**
 * A production-callable task with erased, type-only Eval metadata.
 *
 * @typeParam I - Production and Eval input.
 * @typeParam R - Rich production call result.
 * @typeParam O - Semantic output exposed to Eval checks.
 * @typeParam C - Remaining per-call options.
 * @typeParam V - Compatible Variant override surface.
 * @typeParam Caps - Trace signals captured by the task.
 */
export type EvalTask<
  I,
  R,
  O,
  C extends object,
  V extends object,
  Caps extends EvalCapability,
> = EvalTaskCallable<I, R, C> & EvalTaskTypes<I, R, O, C, V, Caps>;

/** Extract every managed-task parameter without constraining variance. @internal */
type ManagedTaskTypes<T> = [T] extends [never]
  ? never
  : [T] extends [
        EvalTask<infer I, infer R, infer O, infer C, infer V, infer Caps>,
      ]
    ? {
        readonly input: I;
        readonly productionResult: R;
        readonly output: O;
        readonly call: C;
        readonly variant: V;
        readonly capabilities: Caps;
      }
    : never;

/** Any managed Eval task or compatible opaque function. */
export type EvalTaskLike =
  | EvalTask<never, unknown, unknown, object, object, EvalCapability>
  | ((...args: never[]) => unknown);

/** Input accepted by an Eval task. */
export type InputOf<T> = [ManagedTaskTypes<T>] extends [never]
  ? [T] extends [(input: infer I, ...args: never[]) => unknown]
    ? I
    : never
  : ManagedTaskTypes<T>["input"];

/** Semantic output assessed by an Eval. */
export type OutputOf<T> = [ManagedTaskTypes<T>] extends [never]
  ? [T] extends [(...args: never[]) => infer R]
    ? Awaited<R>
    : never
  : ManagedTaskTypes<T>["output"];

/** Remaining call options accepted by an Eval task. */
export type CallOf<T> = [ManagedTaskTypes<T>] extends [never]
  ? [T] extends [(input: never, call: infer C extends object) => unknown]
    ? C
    : Record<string, never>
  : ManagedTaskTypes<T>["call"];

/** Authored Variant override surface of an Eval task. */
export type VariantOf<T> = [ManagedTaskTypes<T>] extends [never]
  ? Record<string, never>
  : ManagedTaskTypes<T>["variant"];

/** Trace-signal capabilities captured by an Eval task. */
export type CapsOf<T> = [ManagedTaskTypes<T>] extends [never]
  ? never
  : ManagedTaskTypes<T>["capabilities"];
