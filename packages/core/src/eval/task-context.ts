/**
 * Public cancellation context for a live Eval task attempt.
 *
 * @module
 */

import type { TimeoutOptions } from "../generation/timeout";
import { currentEvalTaskContext } from "./internal/task-context-scope";

/**
 * Eval-owned nested timeout ceilings that a task may forward to managed calls.
 *
 * @remarks
 * The active cell signal owns the outer `totalMs` deadline, so this projection
 * deliberately omits it. Pass the exact object returned by
 * {@link evalContext}; cloning it drops its private ceiling identity.
 */
export type EvalTaskTimeout = Readonly<Omit<TimeoutOptions, "totalMs">>;

/** Cancellation context for the active Eval task attempt. */
export interface EvalTaskContext {
  /**
   * Aborts when the effective Eval deadline expires or the attempt is
   * otherwise cancelled.
   */
  readonly signal: AbortSignal;
  /**
   * Resolved Eval-owned nested timeout ceilings for the active attempt.
   *
   * @remarks
   * Explicit `null` inheritance overrides are preserved. Pass this exact
   * object to managed calls; do not clone it.
   */
  readonly timeout: EvalTaskTimeout;
}

/**
 * Read the cancellation context for the active Eval task attempt.
 *
 * @remarks
 * The context is stable across awaited work in the current task attempt. It is
 * unavailable to Case assertions, scorers, and unrelated cell work.
 * Cancellation is cooperative and does not forcibly terminate user code.
 *
 * @returns The active, frozen task context.
 * @throws {TypeError} When called outside an active Eval task attempt.
 *
 * @example
 * ```ts
 * import { evalContext } from '@use-crux/core/eval'
 * import { generate } from '@use-crux/ai'
 *
 * const { signal, timeout } = evalContext()
 * return generate(prompt, { model, input, signal, timeout })
 * ```
 */
export function evalContext(): EvalTaskContext {
  const context = currentEvalTaskContext();
  if (context === undefined) {
    throw new TypeError(
      "evalContext() is only available while an Eval task is running.",
    );
  }
  return context;
}

/**
 * Read the active Eval task context when one is installed.
 *
 * @remarks
 * The context follows the current task-only async scope and remains stable
 * across awaited work. Use this accessor when running outside an Eval is an
 * expected condition.
 *
 * @returns The active, frozen task context, or `undefined` outside an Eval
 *   task attempt.
 *
 * @example
 * ```ts
 * import { tryEvalContext } from '@use-crux/core/eval'
 *
 * return fetch(url, { signal: tryEvalContext()?.signal })
 * ```
 */
export function tryEvalContext(): EvalTaskContext | undefined {
  return currentEvalTaskContext();
}
