/** Result joining for Runtime-backed application Work. */

import type { ResolvedRuntimeEngine } from "../../runtime/api/create-runtime";
import { createRuntimeError } from "../../runtime/engine/errors";
import type { WorkId } from "../../runtime/ports/ids";
import type { RuntimeResultRef } from "../../runtime/results/types";
import {
  WorkCancelledError,
  WorkFailedError,
  WorkResultExpiredError,
} from "../errors";

const RESULT_POLL_INTERVAL_MS = 10;

/** Wait for one terminal Work row and return its retained typed result. */
export async function durableWorkResult<TResult>(
  runtime: ResolvedRuntimeEngine,
  id: WorkId,
): Promise<TResult> {
  for (;;) {
    const work = await runtime.store.state.getWork(id, {
      namespace: runtime.namespace,
    });
    if (!work) throw new WorkResultExpiredError(id);
    switch (work.status) {
      case "completed":
        return await readCompletedResult<TResult>(runtime, id, work.resultRef);
      case "dead-letter":
        throw new WorkFailedError(
          id,
          Object.freeze({
            code: work.lastError?.code ?? "work_failed",
            message: work.lastError?.message ?? "Work failed.",
            retryable: false,
          }),
        );
      case "cancelled":
        throw new WorkCancelledError(id);
      case "pending":
      case "leased":
      case "suspended":
      case "blocked":
        await waitForResultPoll();
    }
  }
}

async function readCompletedResult<TResult>(
  runtime: ResolvedRuntimeEngine,
  id: WorkId,
  ref: RuntimeResultRef | undefined,
): Promise<TResult> {
  if (!ref) throw new WorkResultExpiredError(id);
  const results = runtime.store.results;
  if (!results) {
    throw createRuntimeError({
      code: "CAPABILITY_MISSING",
      whatFailed: `result() cannot read retained Work \`${id}\`.`,
      why: "The configured Runtime store has no result payload port.",
      whatStillWorks: "The safe terminal Work status remains readable.",
      nextStep:
        "Reconnect with the Runtime store that accepted and executed this Work.",
    });
  }
  const result = await results.get(ref);
  if (result === null) throw new WorkResultExpiredError(id);
  return result as TResult;
}

function waitForResultPoll(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, RESULT_POLL_INTERVAL_MS));
}
