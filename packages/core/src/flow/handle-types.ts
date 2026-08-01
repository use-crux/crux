/** Public Flow handle, invocation, and result contracts. */

import type { EffectScopeRef } from "../effect";
import type { WithOperationResultMeta } from "../observability";
import type {
  FlowSignalMap,
  FlowSignalPayload,
  FlowSignalPayloadArgs,
  FlowSignalSpec,
  UntypedSignalPayloadArgs,
} from "./signals";

/**
 * Runtime options for starting a Flow through {@link FlowHandle.run}.
 *
 * @remarks Input-bearing Flows receive input as the first
 * `run(input, options?)` argument. These options describe execution metadata.
 */
export interface FlowRunOptions {
  /** Use a specific flowId instead of generating one. */
  flowId?: string;
  /** Explicit parent flow ID for cross-action nesting. */
  parentFlowId?: string;
  /** Goal description for devtools display. */
  goal?: string;
}

/** Runtime options for resuming a suspended Flow through {@link FlowHandle.resume}. */
export interface FlowResumeOptions {
  /** Explicit parent flow ID for cross-action nesting. */
  parentFlowId?: string;
  /** Goal description for devtools display. */
  goal?: string;
}

type FlowRunArgs<TInput> = [TInput] extends [void]
  ? [options?: FlowRunOptions]
  : [input: TInput, options?: FlowRunOptions];

type LocalFlowSignalName<TSignals> = TSignals extends FlowSignalMap
  ? {
      [TName in keyof TSignals]: TSignals[TName] extends FlowSignalSpec
        ? TName
        : never;
    }[keyof TSignals] &
      string
  : string;

type FlowHandleSignal<TSignals> = TSignals extends FlowSignalMap
  ? <TName extends LocalFlowSignalName<TSignals>>(
      flowId: string,
      signalName: TName,
      ...args: TName extends keyof TSignals
        ? FlowSignalPayloadArgs<FlowSignalPayload<TSignals[TName]>>
        : never
    ) => Promise<void>
  : (
      flowId: string,
      signalName: string,
      ...args: UntypedSignalPayloadArgs
    ) => Promise<void>;

/** @internal Unobserved business outcome produced inside a `flow.run` span. */
export type FlowResultPayload<T> =
  | {
      status: "completed";
      output: T;
      flowId: string;
      effects: EffectScopeRef;
    }
  | {
      status: "suspended";
      flowId: string;
      suspendedAt: string;
      effects: EffectScopeRef;
    }
  | {
      status: "cancelled";
      flowId: string;
      cancelReason?: string;
      effects: EffectScopeRef;
    }
  | {
      status: "expired";
      flowId: string;
      suspendedAt: string;
      effects: EffectScopeRef;
    };

/**
 * Result of one Flow invocation, discriminated by lifecycle `status`.
 *
 * @remarks Every member carries the exact `flow.run` operation metadata for
 * the invocation that returned it. A resumed Flow keeps its trace and opens a
 * fresh segment.
 */
export type FlowResult<T> = WithOperationResultMeta<FlowResultPayload<T>>;

/**
 * A frozen, reusable handle returned by `flow()`.
 *
 * @typeParam T - Flow handler return type.
 * @typeParam TInput - Typed input passed to `run(input, options?)`.
 * @typeParam TSignals - Optional mixed local/static Signal declaration map.
 */
export interface FlowHandle<
  T,
  TInput = void,
  TSignals extends FlowSignalMap | undefined = undefined,
> {
  /** The flow's registered name. */
  readonly name: string;
  /**
   * Execute the Flow with typed input and runtime options.
   *
   * @returns The lifecycle result for this invocation, not later consumer work.
   */
  run(...args: FlowRunArgs<TInput>): Promise<FlowResult<T>>;
  /**
   * Resume a suspended Flow with its persisted input.
   *
   * @param flowId - Suspended Flow instance identity.
   * @param options - Optional execution metadata for the resumed segment.
   * @returns The lifecycle result reached by this resume attempt.
   */
  resume(flowId: string, options?: FlowResumeOptions): Promise<FlowResult<T>>;
  /**
   * Send a declared local signal to one suspended Flow instance.
   *
   * @remarks Static Signal sources are deliberately excluded from this method;
   * publish them through their Signal definition instead.
   */
  signal: FlowHandleSignal<TSignals>;
  /**
   * Idempotently cancel a Flow instance and its owned registrations.
   *
   * @param flowId - Flow instance to cancel.
   */
  cancel(flowId: string): Promise<void>;
}
