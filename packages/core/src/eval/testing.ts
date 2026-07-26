/**
 * Explicit testing utilities for Eval task-context consumers.
 *
 * @module
 */

import type { EvalTaskContext } from "./task-context";
import { runWithEvalTaskContext } from "./internal/task-context-scope";

/**
 * Run a callback with an Eval task context installed.
 *
 * @remarks
 * The context and nested timeout object are normalized and frozen before the
 * callback begins. The context remains active through asynchronous work
 * started by the callback when the host supports async context propagation.
 *
 * @typeParam T - Exact synchronous or asynchronous callback result.
 * @param context - Context visible to the Eval task-context accessors.
 * @param callback - Synchronous or asynchronous work to run.
 * @returns The callback result without awaiting or transforming it.
 * @throws {TypeError} When the signal or nested timeout shape is invalid.
 *
 * @example
 * ```ts
 * import { evalContext } from '@use-crux/core/eval'
 * import { withEvalContext } from '@use-crux/core/eval/testing'
 *
 * const result = await withEvalContext(
 *   { signal: controller.signal, timeout: {} },
 *   async () => task(evalContext()),
 * )
 * ```
 */
export function withEvalContext<T>(
  context: EvalTaskContext,
  callback: () => T,
): T {
  return runWithEvalTaskContext(context, callback);
}
