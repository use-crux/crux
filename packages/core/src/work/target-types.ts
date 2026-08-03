/** Internal inference helpers for first-party exported Flow Work targets. */

import type { FlowHandle } from "../flow/handle-types";
import type { FlowSignalMap } from "../flow/signals";
import type { SpawnWorkOptions } from "./handle";

/** Minimal structural Flow shape accepted by the Work factories. @internal */
export type AnyFlowTarget = {
  readonly name: string;
  run(...args: never[]): Promise<unknown>;
};

/** Extract the exact input accepted by an exported Flow target. @internal */
export type WorkTargetInput<TTarget extends AnyFlowTarget> =
  TTarget extends FlowHandle<
    infer _TOutput,
    infer TInput,
    infer _TSignals extends FlowSignalMap | undefined,
    infer _TName extends string
  >
    ? TInput
    : never;

/** Extract the exact successful result returned by an exported Flow target. @internal */
export type WorkTargetOutput<TTarget extends AnyFlowTarget> =
  TTarget extends FlowHandle<
    infer TResult,
    infer _TInput,
    infer _TSignals extends FlowSignalMap | undefined,
    infer _TName extends string
  >
    ? TResult
    : never;

/** Factory argument tuple preserving inputless Flow ergonomics. @internal */
export type SpawnWorkArgs<TTarget extends AnyFlowTarget> =
  [WorkTargetInput<TTarget>] extends [void]
    ? | [options: SpawnWorkOptions]
      | [input: WorkTargetInput<TTarget>, options: SpawnWorkOptions]
    : [input: WorkTargetInput<TTarget>, options: SpawnWorkOptions];
