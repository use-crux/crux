/** Private tagged outcome at the Eval task-host invocation boundary. */

import type { EvalTaskHost } from "./ports";
import { classifyEvalTaskTimeout } from "./task-timeout";
import type {
  EvalCellTimeout,
  EvalTaskHostRequest,
  EvalTaskHostResult,
} from "./types";

export type EvalTaskHostOutcome =
  | {
      readonly status: "completed";
      readonly result: EvalTaskHostResult;
    }
  | {
      readonly status: "timed_out";
      readonly timeout: EvalCellTimeout;
    };

/** Convert only an uncaught canonical timeout into a tagged host outcome. */
export async function executeEvalTaskHost(
  host: EvalTaskHost,
  request: EvalTaskHostRequest,
): Promise<EvalTaskHostOutcome> {
  try {
    return Object.freeze({
      status: "completed",
      result: await host.execute(request),
    });
  } catch (error) {
    const timeout = classifyEvalTaskTimeout(error);
    if (timeout === undefined) throw error;
    return Object.freeze({ status: "timed_out", timeout });
  }
}
