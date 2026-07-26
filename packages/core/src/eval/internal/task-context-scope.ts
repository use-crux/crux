/** Functional async-scope carrier for one live Eval task attempt. */

import { createAsyncScopeFacet } from "../../async-scope";
import type { EvalTaskContext, EvalTaskTimeout } from "../task-context";

const EVAL_TASK_TIMEOUT_MARKER = Symbol.for("@use-crux/core/EvalTaskTimeout");
const NESTED_TIMEOUT_KEYS = [
  "stepMs",
  "chunkMs",
  "firstToken",
  "toolMs",
  "tools",
] as const;
const taskContextScope =
  createAsyncScopeFacet<EvalTaskContext>("core.eval-task");

/** Return the context installed for the current task-only async scope. */
export function currentEvalTaskContext(): EvalTaskContext | undefined {
  return taskContextScope.current();
}

/**
 * Normalize an immutable task context without mutating caller-owned values.
 *
 * @internal
 */
export function normalizeEvalTaskContext(
  context: EvalTaskContext,
): EvalTaskContext {
  assertEvalTaskContext(context);
  const tools =
    context.timeout.tools === undefined
      ? undefined
      : Object.freeze({ ...context.timeout.tools });
  const timeout = {
    ...context.timeout,
    ...(tools === undefined ? {} : { tools }),
  } as EvalTaskTimeout;
  Object.defineProperty(timeout, EVAL_TASK_TIMEOUT_MARKER, { value: true });

  return Object.freeze({
    signal: context.signal,
    timeout: Object.freeze(timeout),
  });
}

/**
 * Run a callback with one normalized Eval task context installed.
 *
 * The callback result is returned unchanged, including a returned Promise.
 *
 * @internal
 */
export function runWithEvalTaskContext<T>(
  context: EvalTaskContext,
  callback: () => T,
): T {
  return taskContextScope.run(normalizeEvalTaskContext(context), callback);
}

function assertEvalTaskContext(
  context: EvalTaskContext,
): asserts context is EvalTaskContext {
  if (!isAbortSignal(context?.signal)) {
    throw new TypeError("Eval task context requires a valid AbortSignal.");
  }
  if (!isRecord(context.timeout)) {
    throw new TypeError(
      "Eval task context timeout accepts only nested timeout budgets.",
    );
  }

  for (const [key, value] of Object.entries(context.timeout)) {
    if (!NESTED_TIMEOUT_KEYS.some((candidate) => candidate === key)) {
      throw new TypeError(
        "Eval task context timeout accepts only nested timeout budgets.",
      );
    }
    if (key === "tools") {
      if (
        value !== undefined &&
        (!isRecord(value) ||
          Object.values(value).some((toolValue) => !isTimeoutValue(toolValue)))
      ) {
        throw new TypeError(
          "Eval task context timeout values must be numbers or null.",
        );
      }
    } else if (!isTimeoutValue(value)) {
      throw new TypeError(
        "Eval task context timeout values must be numbers or null.",
      );
    }
  }
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return (
    isRecord(value) &&
    typeof value.aborted === "boolean" &&
    typeof value.addEventListener === "function" &&
    typeof value.removeEventListener === "function"
  );
}

function isTimeoutValue(value: unknown): value is number | null | undefined {
  return value === undefined || value === null || typeof value === "number";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
