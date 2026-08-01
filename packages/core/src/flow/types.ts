/**
 * Flow scope, wait, and lifecycle option contracts.
 *
 * @module
 */

import type { RetryOptions } from "../generation/retry";
import type {
  EffectScopeRef,
  RollbackOptions,
  RollbackResult,
} from "../effect";
import type { JsonValue } from "../storage";
import type { RuntimeTaskInput, RuntimeTaskTarget } from "../runtime/api/task";
import type { SignalOccurrenceFor, StaticSignalSource } from "../signal/source";
import type { ZodType } from "zod";
import type {
  DeclaredFlowSignalSource,
  FlowSignalMap,
  FlowSignalOptions,
  FlowSignalPayload,
  FlowSignalSpec,
} from "./signals";

export type {
  FlowHandle,
  FlowResult,
  FlowResultPayload,
  FlowResumeOptions,
  FlowRunOptions,
} from "./handle-types";
export type {
  DeliveredFlowSignal,
  DeliveredFlowSignals,
  FlowSnapshot,
} from "./persistence-types";
export {
  FlowCancelledError,
  FlowExpiredError,
  FlowSuspendedError,
} from "./errors";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

type LocalFlowSignalName<TSignals> = TSignals extends FlowSignalMap
  ? {
      [TName in keyof TSignals]: TSignals[TName] extends FlowSignalSpec
        ? TName
        : never;
    }[keyof TSignals] &
      string
  : string;

type FlowScopeSuspend<TSignals> = TSignals extends FlowSignalMap
  ? <TName extends LocalFlowSignalName<TSignals>>(
      name: TName,
      options?: TName extends keyof TSignals
        ? Omit<SuspendOptions<FlowSignalPayload<TSignals[TName]>>, "schema">
        : never,
    ) => Promise<
      TName extends keyof TSignals ? FlowSignalPayload<TSignals[TName]> : never
    >
  : <TPayload = unknown>(
      name: string,
      options?: SuspendOptions<TPayload>,
    ) => Promise<TPayload>;

type FlowScopeStaticSignalSource<TSignals> = TSignals extends FlowSignalMap
  ? DeclaredFlowSignalSource<TSignals>
  : never;

/** Event definition accepted by runtime-backed `flow.waitFor()`. */
export interface FlowWaitForEvent<TPayload = JsonValue> {
  /** Durable event name appended to the Runtime Engine event log. */
  readonly name: string;
  /** Optional schema used to validate the event payload when replay resumes. */
  readonly schema?: ZodType<TPayload>;
}

/** Runtime wait options for `flow.waitFor()`. */
export interface FlowWaitForOptions {
  /** Top-level event payload fields that must equal these JSON values. */
  readonly match?: Readonly<Record<string, JsonValue>>;
  /** Timeout duration string (for example, '24h', '30m', '0ms'). */
  readonly timeout?: string;
}

/** Options for {@link FlowScope.waitFor} with a declared static Signal source. */
export interface FlowWaitForSignalOptions {
  /** Flow duration syntax. @defaultValue `undefined` (no deadline). */
  readonly timeout?: string;
}

/** Options for scoped idle waiting. */
export interface FlowUntilIdleOptions {
  /** v1 supports waiting for child work in the current flow only. */
  readonly scope: "current-flow";
}

/** Internal runtime metadata carried by flow suspension control errors. */
export interface RuntimeFlowSuspendMetadata {
  /** Durable event name registered with the waiter port. */
  readonly eventName: string;
  /** Static Signal identity when the wait requires durable publication. */
  readonly signalId?: string;
  /** Canonical match data for a filtered static Signal source. */
  readonly signalMatch?: JsonValue;
  /** Whether deployed Flow code must evaluate a durable predicate candidate. */
  readonly signalPredicate?: true;
  /** Top-level payload equality match registered with the waiter port. */
  readonly match: Readonly<Record<string, JsonValue>>;
  /** Replay fingerprint entry emitted for this suspension. */
  readonly fingerprint: string;
}

export type { FlowSignalOptions };

/** Options for `flow.suspend()`. */
export interface SuspendOptions<T = unknown> {
  /** Zod schema for the expected signal payload. Validated on signal delivery. */
  schema?: ZodType<T>;
  /** Timeout duration string (e.g., '24h', '30m', '0ms'). Flow expires if not signaled within this period. */
  timeout?: string;
  /** Callback invoked when a flow is detected as expired on resume. */
  onExpired?: (state: {
    flowId: string;
    suspendedAt: string;
  }) => void | Promise<void>;
}

/** Retry and fallback options for a flow step. Re-exported from shared retry module. */
export type StepOptions = RetryOptions;

export interface FlowScope<
  TInput = void,
  TSignals extends FlowSignalMap | undefined = undefined,
> {
  /** The flow's unique identifier. */
  readonly flowId: string;

  /** Typed input data passed via `flow().run()` options. */
  readonly input: TInput;

  /** Accumulated step results keyed by step label. Auto-populated after each step completes. */
  readonly results: Record<string, unknown>;

  /** In-process reference to this flow run's passive rollback boundary. */
  readonly effects: EffectScopeRef;

  /** Roll back completed recovery units owned by this flow run. */
  rollback(options?: RollbackOptions): Promise<RollbackResult>;

  /**
   * Execute a named step within the flow.
   *
   * Sets `stepId` and `stepLabel` in trace context so all `generate()` calls
   * inside are tagged. Emits `runtime-flow:step` events to devtools.
   *
   * Accepts both `() => T` (plain function) and `(flow: FlowScope) => T`
   * (flow-aware function). Flow-aware functions receive the scope automatically,
   * enabling external step definitions that access `flow.input`, `flow.results`, etc.
   *
   * @param label — Human-readable step name (also used to derive stepId)
   * @param fn — The step's execution function (plain or flow-aware)
   * @param options — Optional retry/fallback configuration
   */
  step<T>(
    label: string,
    fn:
      | ((flow: FlowScope<TInput, TSignals>) => Promise<T> | T)
      | (() => Promise<T> | T),
    options?: StepOptions,
  ): Promise<T>;

  /**
   * Suspend the flow at a named point and wait for an external signal.
   *
   * Throws internally to unwind the call stack. The flow runtime catches this,
   * persists the flow snapshot to the store, and returns `{ status: 'suspended' }`.
   * No code after `suspend()` executes in the current call.
   *
   * On resume, the signal payload is returned (typed if schema is provided).
   */
  suspend: FlowScopeSuspend<TSignals>;

  /**
   * Suspend the flow until a condition function returns true.
   *
   * On the first call (or resume when condition is still false), suspends the flow.
   * On resume, re-evaluates the condition. If true, continues; if false, re-suspends.
   *
   * Supports the same timeout/onExpired options as `suspend()`.
   *
   * @param name — Suspend point name (used as signal name internally)
   * @param conditionFn — Evaluated on each resume attempt; flow continues when it returns true
   * @param options — Optional timeout/onExpired configuration
   */
  waitUntil(
    name: string,
    conditionFn: () => boolean | Promise<boolean>,
    options?: Omit<SuspendOptions, "schema">,
  ): Promise<void>;

  /**
   * Suspend the Flow until a declared Signal or durable Runtime event arrives.
   *
   * A declared static Signal source resolves with its complete typed
   * occurrence. Event waits retain their existing payload-only behavior. Both
   * forms register a durable waiter and replay the delivery that won its race.
   *
   * @remarks Registration of the Flow suspension and its required durable
   * delivery binding is atomic. Resumption is at least once, while Signal
   * publication itself resolves earlier at acceptance.
   *
   * @param source - Static Signal source declared by this Flow.
   * @param options - Optional durable wait deadline.
   * @returns The complete typed Signal occurrence selected for this wait.
   * @throws `CruxRuntimeError` with `CAPABILITY_MISSING` when the configured
   * deployment or store cannot honor durable Signal delivery.
   */
  waitFor<const TSource extends FlowScopeStaticSignalSource<TSignals>>(
    source: TSource,
    options?: FlowWaitForSignalOptions,
  ): Promise<SignalOccurrenceFor<TSource>>;
  /**
   * Suspend the Flow until a named durable Runtime event arrives.
   *
   * @param event - Event name or schema-bearing event definition.
   * @param options - Optional top-level match data and deadline.
   * @returns The event payload selected for this wait.
   */
  waitFor<TPayload = JsonValue>(
    event: string | FlowWaitForEvent<TPayload>,
    options?: FlowWaitForOptions,
  ): Promise<TPayload>;

  /**
   * Buffer a durable task to run independently at the next flow progress
   * barrier.
   *
   * The task becomes durable together with the next suspension or completion
   * snapshot. On replay, a previously flushed occurrence returns the recorded
   * child work id instead of enqueueing again.
   */
  defer<TTask extends RuntimeTaskTarget>(
    task: TTask,
    input: RuntimeTaskInput<TTask>,
  ): Promise<{ workId: string }>;

  /**
   * Buffer a durable task timer to be scheduled at the next flow progress
   * barrier.
   *
   * The timer is independent of the parent flow and contributes to
   * `untilIdle({ scope: "current-flow" })` once it fires.
   */
  after<TTask extends RuntimeTaskTarget>(
    task: TTask,
    delay: string,
    input: RuntimeTaskInput<TTask>,
  ): Promise<void>;

  /**
   * Suspend until child work in the requested scope reaches terminal state.
   *
   * v1 only supports the current flow's child scope. Global idle is not a
   * runtime primitive.
   */
  untilIdle(options: FlowUntilIdleOptions): Promise<void>;

  /**
   * Cancel the flow with an optional reason.
   *
   * Throws internally to unwind the call stack. The flow runtime catches this
   * and returns `{ status: 'cancelled', cancelReason }`.
   */
  cancel(reason?: string): never;
}

/** Options for listing flows. */
export interface ListFlowsOptions {
  /** Filter by flow status. */
  status?: "suspended" | "completed" | "cancelled" | "expired";
}

/** Summary metadata for a listed flow. */
export interface FlowSummary {
  flowId: string;
  name: string;
  status: string;
  suspendedAt: string;
  createdAt: number;
  updatedAt: number;
  timeoutAt?: number;
}
