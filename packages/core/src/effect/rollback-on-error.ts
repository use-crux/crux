/**
 * Automatic rollback boundaries for custom effects.
 *
 * @module
 */

import { runScope } from "../scope/internal";
import { RollbackError } from "./errors";
import {
  createEffectBoundary,
  createEffectBoundaryId,
  effectBoundaryFacet,
  waitForEffectBoundaryOperations,
} from "./internal/boundary";
import { effectLedger } from "./internal/ledger";
import { runRollback } from "./internal/run-rollback";
import type {
  Awaitable,
  RollbackBoundaryController,
  RollbackOnErrorOptions,
} from "./types";

/**
 * Run work in a boundary that automatically recovers completed effects.
 *
 * By default, effects without recovery are rejected before execution. Pass
 * `{ recovery: "best-effort" }` to permit irreversible effects and receive
 * an honest partial rollback if later work fails.
 *
 * @param run - Work to execute inside the rollback boundary.
 * @param options - Recovery guarantee for effects encountered by the work.
 * @returns The callback result when the boundary completes normally.
 *
 * @example
 * ```ts
 * const customer = await rollbackOnError(async () => {
 *   const customer = await createCustomer(input)
 *   await chargeCustomer(customer)
 *   return customer
 * })
 * ```
 */
export async function rollbackOnError<T>(
  run: (scope: RollbackBoundaryController) => Awaitable<T>,
  options?: RollbackOnErrorOptions,
): Promise<T> {
  const recovery = options?.recovery ?? "required";
  return runScope(
    {
      kind: "effect-boundary",
      id: createEffectBoundaryId(),
    },
    {},
    async (scope) => {
      const boundary = createEffectBoundary(scope, recovery);
      scope.setFacet(effectBoundaryFacet, boundary);
      effectLedger.registerScope({
        ref: boundary.ref,
        status: "open",
        unitIds: [],
      });
      const controller: RollbackBoundaryController = Object.freeze({
        ref: boundary.ref,
        rollback: async () => {
          throw new TypeError(
            "Manual rollback is not available on this boundary.",
          );
        },
      });

      try {
        const value = await run(controller);
        updateBoundary(boundary.ref.id, "closed");
        return value;
      } catch (cause) {
        updateBoundary(boundary.ref.id, "rolling_back");
        await waitForEffectBoundaryOperations(boundary);
        let execution: Awaited<ReturnType<typeof runRollback>>;
        try {
          execution = await runRollback(boundary.ref);
        } catch (recoveryError) {
          updateBoundary(boundary.ref.id, "completed");
          throw new RollbackError({ cause, recoveryError });
        }
        updateBoundary(boundary.ref.id, "completed");
        if (
          execution.result.status === "completed" &&
          execution.recoveryError === undefined
        ) {
          throw cause;
        }
        throw new RollbackError({
          cause,
          result: execution.result,
          recoveryError: execution.recoveryError,
        });
      }
    },
  );
}

function updateBoundary(
  id: string,
  status: "rolling_back" | "completed" | "closed",
): void {
  const scope = effectLedger.getScope(id);
  if (!scope) {
    throw new TypeError(`Effect boundary \`${id}\` was not found.`);
  }
  effectLedger.registerScope({
    ...scope,
    status,
    unitIds: effectLedger.unitsFor(id).map((unit) => unit.id),
  });
}
