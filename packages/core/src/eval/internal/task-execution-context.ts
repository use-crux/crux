/**
 * Private execution context passed through managed Eval task descriptors.
 *
 * This seam keeps engine-owned cancellation separate from authored Case call
 * data and from the public six-parameter {@link EvalTask} type.
 *
 * @internal
 * @module
 */

import type { EvalTaskTimeout } from "../task-context";
import {
  clampEvalTimeoutCeilingForInternalUse,
  composeAbortSignals,
  resolveTimeoutOverrideForInternalUse,
} from "../../generation/timeout";
import type { TimeoutOptions } from "../../generation/timeout";
import {
  currentEvalTaskContext,
  normalizeEvalTaskContext,
} from "./task-context-scope";

/** Engine-owned values available only while a managed task executes. */
export interface EvalTaskExecutionContext {
  /** Stable cancellation signal for the live cell attempt. */
  readonly signal: AbortSignal;
  /** Exact privately marked nested Eval timeout ceiling. */
  readonly timeout: EvalTaskTimeout;
}

const INERT_EXECUTION_CONTEXT = normalizeEvalTaskContext({
  signal: new AbortController().signal,
  timeout: {},
});

/**
 * Read the exact active task context or an inert context for direct internals.
 *
 * Direct protocol tests and adapter-owned utilities can execute a descriptor
 * outside an Eval cell. They still receive the current execution-contract
 * shape, but its signal never aborts and its ceiling imposes no budgets.
 */
export function evalTaskExecutionContextForInternalUse(): EvalTaskExecutionContext {
  return currentEvalTaskContext() ?? INERT_EXECUTION_CONTEXT;
}

/**
 * Apply engine-owned cancellation after task/default/Variant resolution.
 *
 * The cell signal remains exact when it is the sole source. If an internal
 * caller supplied another signal, the returned signal preserves the first
 * cancellation reason from either source.
 */
export function applyEvalTaskExecutionContext(
  options: Readonly<Record<string, unknown>>,
  context: EvalTaskExecutionContext,
): Readonly<Record<string, unknown>> {
  const callerSignal = isAbortSignal(options.signal)
    ? options.signal
    : undefined;
  const productionTimeout = isTimeoutOptions(options.timeout)
    ? options.timeout
    : undefined;
  const timeout = clampEvalTimeoutCeilingForInternalUse(
    productionTimeout,
    context.timeout,
  );
  return Object.freeze({
    ...options,
    ...(timeout === undefined ? {} : { timeout }),
    signal: composeAbortSignals(context.signal, callerSignal) ?? context.signal,
  });
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return (
    typeof value === "object" &&
    value !== null &&
    "aborted" in value &&
    typeof value.aborted === "boolean" &&
    "addEventListener" in value &&
    typeof value.addEventListener === "function"
  );
}

/** Resolve one timeout option with ordinary or marked ownership semantics. */
export function resolveTaskTimeoutOverrideForInternalUse(
  production: unknown,
  override: unknown,
): unknown {
  return isTimeoutOptions(override)
    ? resolveTimeoutOverrideForInternalUse(
        isTimeoutOptions(production) ? production : undefined,
        override,
      )
    : override;
}

function isTimeoutOptions(value: unknown): value is TimeoutOptions {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
