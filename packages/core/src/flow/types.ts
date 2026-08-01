/**
 * Flow type definitions and error classes.
 *
 * Extracted from scope.ts — contains all type/interface definitions
 * and control-flow error classes used by the flow module.
 *
 * @module
 */

import type { RetryOptions } from '../generation/retry'
import type { WithOperationResultMeta } from '../observability'
import type {
  EffectScopeRef,
  RollbackOptions,
  RollbackResult,
} from '../effect'
import type { JsonObject, JsonValue } from '../storage'
import type { RuntimeTaskInput, RuntimeTaskTarget } from '../runtime/api/task'
import type { ZodType } from 'zod'
import type {
  FlowSignalMap,
  FlowSignalOptions,
  FlowSignalPayload,
  FlowSignalPayloadArgs,
  UntypedSignalPayloadArgs,
} from './signals'

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

/**
 * Runtime options for starting a flow through `FlowHandle.run()`.
 *
 * Input-bearing flows receive input as the first `run(input, options?)`
 * argument. These options only describe execution metadata.
 */
export interface FlowRunOptions {
  /** Use a specific flowId instead of generating one. */
  flowId?: string
  /** Explicit parent flow ID for cross-action nesting. */
  parentFlowId?: string
  /** Goal description for devtools display. */
  goal?: string
}

/** Runtime options for resuming a suspended flow through `FlowHandle.resume()`. */
export interface FlowResumeOptions {
  /** Explicit parent flow ID for cross-action nesting. */
  parentFlowId?: string
  /** Goal description for devtools display. */
  goal?: string
}

type FlowRunArgs<TInput> = [TInput] extends [void]
  ? [options?: FlowRunOptions]
  : [input: TInput, options?: FlowRunOptions]

type FlowSignalName<TSignals> = TSignals extends FlowSignalMap ? keyof TSignals & string : string

type FlowHandleSignal<TSignals> = TSignals extends FlowSignalMap
  ? <TName extends FlowSignalName<TSignals>>(
      flowId: string,
      signalName: TName,
      ...args: TName extends keyof TSignals ? FlowSignalPayloadArgs<FlowSignalPayload<TSignals[TName]>> : never
    ) => Promise<void>
  : (flowId: string, signalName: string, ...args: UntypedSignalPayloadArgs) => Promise<void>

type FlowScopeSuspend<TSignals> = TSignals extends FlowSignalMap
  ? <TName extends FlowSignalName<TSignals>>(
      name: TName,
      options?: TName extends keyof TSignals
        ? Omit<SuspendOptions<FlowSignalPayload<TSignals[TName]>>, 'schema'>
        : never,
    ) => Promise<TName extends keyof TSignals ? FlowSignalPayload<TSignals[TName]> : never>
  : <TPayload = unknown>(name: string, options?: SuspendOptions<TPayload>) => Promise<TPayload>

/** Event definition accepted by runtime-backed `flow.waitFor()`. */
export interface FlowWaitForEvent<TPayload = JsonValue> {
  /** Durable event name appended to the Runtime Engine event log. */
  readonly name: string
  /** Optional schema used to validate the event payload when replay resumes. */
  readonly schema?: ZodType<TPayload>
}

/** Runtime wait options for `flow.waitFor()`. */
export interface FlowWaitForOptions {
  /** Top-level event payload fields that must equal these JSON values. */
  readonly match?: Readonly<Record<string, JsonValue>>
  /** Timeout duration string (for example, '24h', '30m', '0ms'). */
  readonly timeout?: string
}

/** Options for scoped idle waiting. */
export interface FlowUntilIdleOptions {
  /** v1 supports waiting for child work in the current flow only. */
  readonly scope: 'current-flow'
}

/** Internal runtime metadata carried by flow suspension control errors. */
export interface RuntimeFlowSuspendMetadata {
  /** Durable event name registered with the waiter port. */
  readonly eventName: string
  /** Top-level payload equality match registered with the waiter port. */
  readonly match: Readonly<Record<string, JsonValue>>
  /** Replay fingerprint entry emitted for this suspension. */
  readonly fingerprint: string
}

/**
 * A frozen handle returned by `flow()`.
 *
 * Separates flow definition from execution — define once, run many times.
 *
 * @typeParam T — The flow's return type (inferred from the handler).
 * @typeParam TInput — The typed input passed to `run(input, options?)`.
 * @typeParam TSignals — Optional local signal map used to type `.signal()`.
 */
export interface FlowHandle<T, TInput = void, TSignals extends FlowSignalMap | undefined = undefined> {
  /** The flow's registered name. */
  readonly name: string
  /**
   * Execute the flow with runtime options.
   *
   * Delegates to the internal flow execution engine and returns a `FlowResult<T>`.
   */
  run(...args: FlowRunArgs<TInput>): Promise<FlowResult<T>>
  /**
   * Resume a suspended flow instance.
   *
   * The original input is restored from the persisted flow snapshot and passed
   * back to the handler. Resume options only describe execution metadata.
   *
   * @param flowId - The ID of the suspended flow instance.
   * @param options - Optional execution metadata for the resumed run.
   */
  resume(flowId: string, options?: FlowResumeOptions): Promise<FlowResult<T>>
  /**
   * Send a signal to a suspended instance of this flow.
   *
   * Delegates to `signalFlow()` — writes the signal payload to the store
   * so the next resume picks it up.
   *
   * @param flowId — The ID of the suspended flow instance
   * @param signalName — The suspend point name to signal
   * @param payload — Optional JSON payload delivered to the suspend point
   * @param options — Runtime delivery options. Use `{ resume: false }` to store the signal without nudging resume.
   */
  signal: FlowHandleSignal<TSignals>

  /**
   * Cancel a flow instance by id.
   *
   * Cancellation is idempotent. Runtime-backed cancellation atomically marks
   * both the durable work and flow snapshot terminal.
   */
  cancel(flowId: string): Promise<void>
}

export type { FlowSignalOptions }

/** Options for `flow.suspend()`. */
export interface SuspendOptions<T = unknown> {
  /** Zod schema for the expected signal payload. Validated on signal delivery. */
  schema?: ZodType<T>
  /** Timeout duration string (e.g., '24h', '30m', '0ms'). Flow expires if not signaled within this period. */
  timeout?: string
  /** Callback invoked when a flow is detected as expired on resume. */
  onExpired?: (state: { flowId: string; suspendedAt: string }) => void | Promise<void>
}

/** Retry and fallback options for a flow step. Re-exported from shared retry module. */
export type StepOptions = RetryOptions

/** @internal Unobserved business outcome produced inside a `flow.run` span. */
export type FlowResultPayload<T> =
  | { status: 'completed'; output: T; flowId: string; effects: EffectScopeRef }
  | { status: 'suspended'; flowId: string; suspendedAt: string; effects: EffectScopeRef }
  | { status: 'cancelled'; flowId: string; cancelReason?: string; effects: EffectScopeRef }
  | { status: 'expired'; flowId: string; suspendedAt: string; effects: EffectScopeRef }

/**
 * Result of one flow invocation, discriminated by lifecycle `status`.
 *
 * Every member carries the exact `flow.run` span for the invocation that
 * returned it. A resumed flow keeps its trace but receives a fresh span.
 */
export type FlowResult<T> = WithOperationResultMeta<FlowResultPayload<T>>

/** @internal JSON-safe Effect boundary reference retained in a flow snapshot. */
type FlowSnapshotEffectScopeRef = {
  readonly kind: 'effect.scope'
  readonly id: string
  readonly runId: string
}

/** Persisted, occurrence-keyed signal delivery record used for suspend replay. */
export interface DeliveredFlowSignal extends JsonObject {
  /** Signal name that was delivered to a suspend point. */
  signalName: string
  /** Validated signal payload replayed for this suspend occurrence. */
  payload: JsonValue
  /** Unix timestamp recorded when the pending signal was consumed. */
  deliveredAt: number
}

/** Persisted, occurrence-keyed suspend payloads used for resume replay. */
export interface DeliveredFlowSignals extends JsonObject {
  [key: string]: DeliveredFlowSignal | undefined
}

/** Persisted flow snapshot stored in a RecordStore. */
export interface FlowSnapshot extends JsonObject {
  flowId: string
  /** In-process Effect boundary retained across flow execution segments. */
  effects?: FlowSnapshotEffectScopeRef
  name: string
  status: string
  suspendedAt: string
  completedSteps: Record<
    string,
    {
      output: JsonValue
      durationMs: number
    }
  >
  /**
   * Validated suspend payloads that have already crossed the pending-signal
   * boundary. Keys include the source-order suspend occurrence so repeated
   * signal names do not accidentally replay stale approvals.
   */
  deliveredSignals?: DeliveredFlowSignals
  traceContext: JsonObject
  /** Serializable carrier used to resume this flow in a fresh run segment. */
  continuation?: JsonObject
  createdAt: number
  updatedAt: number
  /** Unix timestamp recorded when the flow reaches `completed`. */
  completedAt?: number
  /** Unix timestamp recorded when the flow reaches `cancelled`. */
  cancelledAt?: number
  /** Unix timestamp recorded when the flow reaches `expired`. */
  expiredAt?: number
  /** Optional cancellation reason stored with terminal cancelled snapshots. */
  cancelReason?: string
}

export interface FlowScope<TInput = void, TSignals extends FlowSignalMap | undefined = undefined> {
  /** The flow's unique identifier. */
  readonly flowId: string

  /** Typed input data passed via `flow().run()` options. */
  readonly input: TInput

  /** Accumulated step results keyed by step label. Auto-populated after each step completes. */
  readonly results: Record<string, unknown>

  /** In-process reference to this flow run's passive rollback boundary. */
  readonly effects: EffectScopeRef

  /** Roll back completed recovery units owned by this flow run. */
  rollback(options?: RollbackOptions): Promise<RollbackResult>

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
    fn: ((flow: FlowScope<TInput, TSignals>) => Promise<T> | T) | (() => Promise<T> | T),
    options?: StepOptions,
  ): Promise<T>

  /**
   * Suspend the flow at a named point and wait for an external signal.
   *
   * Throws internally to unwind the call stack. The flow runtime catches this,
   * persists the flow snapshot to the store, and returns `{ status: 'suspended' }`.
   * No code after `suspend()` executes in the current call.
   *
   * On resume, the signal payload is returned (typed if schema is provided).
   */
  suspend: FlowScopeSuspend<TSignals>

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
    options?: Omit<SuspendOptions, 'schema'>,
  ): Promise<void>

  /**
   * Suspend the flow until a durable Runtime Engine event arrives.
   *
   * This is runtime-bound sugar over the waiter port. On first execution it
   * registers a durable waiter and unwinds the flow. On replay, the same
   * `await` resolves with the event payload that won the waiter race.
   */
  waitFor<TPayload = JsonValue>(
    event: string | FlowWaitForEvent<TPayload>,
    options?: FlowWaitForOptions,
  ): Promise<TPayload>

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
  ): Promise<{ workId: string }>

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
  ): Promise<void>

  /**
   * Suspend until child work in the requested scope reaches terminal state.
   *
   * v1 only supports the current flow's child scope. Global idle is not a
   * runtime primitive.
   */
  untilIdle(options: FlowUntilIdleOptions): Promise<void>

  /**
   * Cancel the flow with an optional reason.
   *
   * Throws internally to unwind the call stack. The flow runtime catches this
   * and returns `{ status: 'cancelled', cancelReason }`.
   */
  cancel(reason?: string): never
}

/** Options for listing flows. */
export interface ListFlowsOptions {
  /** Filter by flow status. */
  status?: 'suspended' | 'completed' | 'cancelled' | 'expired'
}

/** Summary metadata for a listed flow. */
export interface FlowSummary {
  flowId: string
  name: string
  status: string
  suspendedAt: string
  createdAt: number
  updatedAt: number
  timeoutAt?: number
}

// ─────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────

/**
 * Thrown by `flow.suspend()` to unwind the call stack.
 * Caught by the flow runtime — not a user-facing error.
 */
export class FlowSuspendedError extends Error {
  readonly _tag = 'FlowSuspendedError' as const
  constructor(
    public readonly suspendPoint: string,
    public readonly options?: SuspendOptions,
    public readonly runtime?: RuntimeFlowSuspendMetadata,
  ) {
    super(`Flow suspended at: ${suspendPoint}`)
    this.name = 'FlowSuspendedError'
  }
}

/**
 * Thrown by `flow.cancel()` to unwind the call stack.
 * Caught by the flow runtime — not a user-facing error.
 */
export class FlowCancelledError extends Error {
  readonly _tag = 'FlowCancelledError' as const
  constructor(public readonly reason?: string) {
    super(`Flow cancelled${reason ? `: ${reason}` : ''}`)
    this.name = 'FlowCancelledError'
  }
}

/**
 * Thrown internally when a flow's timeout has been exceeded.
 * Caught by the flow runtime — not a user-facing error.
 */
export class FlowExpiredError extends Error {
  readonly _tag = 'FlowExpiredError' as const
  constructor(public readonly suspendPoint: string) {
    super(`Flow expired at: ${suspendPoint}`)
    this.name = 'FlowExpiredError'
  }
}
