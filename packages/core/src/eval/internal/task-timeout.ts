/** Canonical timeout classification at the Eval task-host boundary. */

import { isCruxAdapterError } from "../../adapter/normalized-outcome";
import { TimeoutError } from "../../generation/timeout";
import type { EvalCellTimeout } from "./types";

/**
 * Project an unhandled canonical task timeout without parsing error messages.
 *
 * Core adapter calls deliberately normalize provider failures. Their exact
 * canonical timeout remains the direct `cause`, so that one known wrapper is
 * unwrapped. Arbitrary user-transformed causal chains remain ordinary errors.
 */
export function classifyEvalTaskTimeout(
  error: unknown,
): EvalCellTimeout | undefined {
  const timeout = TimeoutError.isInstance(error)
    ? error
    : isCruxAdapterError(error) && TimeoutError.isInstance(error.cause)
      ? error.cause
      : undefined;
  if (timeout === undefined) return undefined;

  return Object.freeze({
    budget: timeout.budget,
    limitMs: timeout.limitMs,
    ...(timeout.toolName !== undefined ? { toolName: timeout.toolName } : {}),
  });
}
