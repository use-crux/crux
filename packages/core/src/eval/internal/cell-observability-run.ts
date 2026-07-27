/**
 * Terminal-once normal-observability owner for one live Eval task attempt.
 *
 * @internal
 * @module
 */

import { observe, type CruxRunId } from "../../observability";
import { createScopeFacetSlot } from "../../scope/facets";
import { currentScope, currentScopeFacet } from "../../scope/kernel";
import { classifyEvalTaskTimeout } from "./task-timeout";
import type { EvalCellTimeout, EvalTaskHostRequest } from "./types";

interface EvalCellObservabilityRun {
  readonly runId: CruxRunId;
  withContext<T>(fn: () => T | Promise<T>): T | Promise<T>;
  ok(): void;
  error(error: unknown): void;
  timeout(timeout: EvalCellTimeout): void;
}

const cellObservabilityRunSlot =
  createScopeFacetSlot<EvalCellObservabilityRun>(
    "core.eval-cell-observability-run",
  );

function timeoutAttributes(timeout: EvalCellTimeout) {
  return Object.freeze({
    evalOutcome: "timed_out" as const,
    timeoutBudget: timeout.budget,
    timeoutLimitMs: timeout.limitMs,
    ...(timeout.budget === "tool" && timeout.toolName !== undefined
      ? { timeoutToolName: timeout.toolName }
      : {}),
  });
}

/**
 * Open and attach the one normal-observability root for a live task attempt.
 *
 * @param request - Admitted task-host request identifying the Eval cell.
 * @returns A terminal-once owner whose context contains all task evidence.
 */
export function openEvalCellObservabilityRun(
  request: EvalTaskHostRequest,
): EvalCellObservabilityRun {
  const scope = currentScope();
  if (scope?.descriptor.kind !== "eval-cell") {
    throw new TypeError(
      "Eval cell observability requires an active eval-cell scope.",
    );
  }
  const existing = scope.facet(cellObservabilityRunSlot);
  if (existing) return existing;

  const run = observe.openRun({
    name: `${request.evalId}:${request.caseId}:${request.variant}`,
    rootPrimitive: "eval.case",
    attributes: {
      evalId: request.evalId,
      caseId: request.caseId,
      variant: request.variant,
      trial: request.trial,
    },
  });
  let terminal = false;
  const finish = (end: () => void): void => {
    if (terminal) return;
    terminal = true;
    end();
  };
  const owner = Object.freeze({
    runId: run.runId,
    withContext: <T>(fn: () => T | Promise<T>) => run.withContext(fn),
    ok: () => finish(() => run.end()),
    error: (error: unknown) => {
      const timeout = classifyEvalTaskTimeout(error);
      if (timeout !== undefined) {
        finish(() =>
          run.end({
            status: "cancelled",
            attributes: timeoutAttributes(timeout),
          }),
        );
        return;
      }
      finish(() => run.error(error));
    },
    timeout: (timeout: EvalCellTimeout) =>
      finish(() =>
        run.end({
          status: "cancelled",
          attributes: timeoutAttributes(timeout),
        }),
      ),
  }) satisfies EvalCellObservabilityRun;
  scope.setFacet(cellObservabilityRunSlot, owner);
  return owner;
}

/** Terminalize the active live attempt as a structured timeout, once. */
export function timeoutEvalCellObservabilityRun(
  timeout: EvalCellTimeout,
): void {
  currentScopeFacet(cellObservabilityRunSlot)?.timeout(timeout);
}
