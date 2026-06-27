/**
 * Flow type definitions and error classes.
 *
 * Extracted from scope.ts — contains all type/interface definitions
 * and control-flow error classes used by the flow module.
 *
 * @module
 */

import type { RetryOptions } from '../generation/retry'
import type { JsonObject } from '../store/types'
import type { CapturedObservabilityContext } from '../observability'
import type { ZodType } from 'zod'

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface WithFlowOptions<TInput = void> {
  /** Use a specific flowId instead of generating one (for cross-action correlation). */
  flowId?: string
  /** Explicit parent flow ID for cross-action nesting (when AsyncLocalStorage context is lost). */
  parentFlowId?: string
  /** Goal description for devtools display. */
  goal?: string
  /** Resume a previously suspended flow by its flowId. */
  resume?: string
  /** Typed input data available on `flow.input` within all steps. */
  input?: TInput
}

/** Runtime options for `FlowHandle.run()`. Excludes the handler and name (captured at definition time). */
export interface FlowRunOptions<TInput = void> {
  /** Typed input data available on `flow.input` within all steps. */
  input?: TInput
  /** Use a specific flowId instead of generating one. */
  flowId?: string
  /** Explicit parent flow ID for cross-action nesting. */
  parentFlowId?: string
  /** Goal description for devtools display. */
  goal?: string
  /** Resume a previously suspended flow by its flowId. */
  resume?: string
}

/**
 * A frozen handle returned by `flow()`.
 *
 * Separates flow definition from execution — define once, run many times.
 *
 * @typeParam T — The flow's return type (inferred from the handler).
 * @typeParam TInput — The typed input available on `flow.input` (default: `void`).
 */
export interface FlowHandle<T, TInput = void> {
  /** The flow's registered name. */
  readonly name: string
  /**
   * Execute the flow with optional input and runtime options.
   *
   * Delegates to the internal flow execution engine and returns a `FlowResult<T>`.
   */
  run(options?: FlowRunOptions<TInput>): Promise<FlowResult<T>>
  /**
   * Send a signal to a suspended instance of this flow.
   *
   * Delegates to `signalFlow()` — writes the signal payload to the store
   * so the next resume picks it up.
   *
   * @param flowId — The ID of the suspended flow instance
   * @param signalName — The suspend point name to signal
   * @param payload — Optional JSON payload delivered to the suspend point
   */
  signal(flowId: string, signalName: string, payload?: JsonObject): Promise<void>
}

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

/** Result of a flow execution — discriminated union on `status`. */
export type FlowResult<T> =
  | { status: 'completed'; output: T; flowId: string }
  | { status: 'suspended'; flowId: string; suspendedAt: string }
  | { status: 'cancelled'; flowId: string; cancelReason?: string }
  | { status: 'expired'; flowId: string; suspendedAt: string }

/** Persisted flow snapshot stored in CruxStore. */
export interface FlowSnapshot extends JsonObject {
  flowId: string
  name: string
  status: string
  suspendedAt: string
  completedSteps: Record<
    string,
    {
      output: JsonObject | string | number | boolean | null
      durationMs: number
    }
  >
  traceContext: Record<string, unknown>
  observabilityContext?: CapturedObservabilityContext
  createdAt: number
  updatedAt: number
  [key: string]: unknown
}

export interface FlowScope<TInput = void> {
  /** The flow's unique identifier. */
  readonly flowId: string

  /** Typed input data passed via `flow().run()` options. */
  readonly input: TInput

  /** Accumulated step results keyed by step label. Auto-populated after each step completes. */
  readonly results: Record<string, unknown>

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
    fn: ((flow: FlowScope<TInput>) => Promise<T> | T) | (() => Promise<T> | T),
    options?: StepOptions,
  ): Promise<T>

  /**
   * Suspend the flow at a named point and wait for an external signal.
   *
   * Throws internally to unwind the call stack. `withFlow()` catches this,
   * persists the flow snapshot to the store, and returns `{ status: 'suspended' }`.
   * No code after `suspend()` executes in the current call.
   *
   * On resume, the signal payload is returned (typed if schema is provided).
   */
  suspend<T = unknown>(name: string, options?: SuspendOptions<T>): Promise<T>

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
   * Cancel the flow with an optional reason.
   *
   * Throws internally to unwind the call stack. `withFlow()` catches this
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
 * Caught by `withFlow()` — not a user-facing error.
 */
export class FlowSuspendedError extends Error {
  readonly _tag = 'FlowSuspendedError' as const
  constructor(
    public readonly suspendPoint: string,
    public readonly options?: SuspendOptions,
  ) {
    super(`Flow suspended at: ${suspendPoint}`)
    this.name = 'FlowSuspendedError'
  }
}

/**
 * Thrown by `flow.cancel()` to unwind the call stack.
 * Caught by `withFlow()` — not a user-facing error.
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
 * Caught by `withFlow()` — not a user-facing error.
 */
export class FlowExpiredError extends Error {
  readonly _tag = 'FlowExpiredError' as const
  constructor(public readonly suspendPoint: string) {
    super(`Flow expired at: ${suspendPoint}`)
    this.name = 'FlowExpiredError'
  }
}
