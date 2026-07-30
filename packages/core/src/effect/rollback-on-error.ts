/**
 * Automatic rollback boundaries for custom effects.
 *
 * @module
 */

import { runScope } from "../scope/internal";
import { RollbackError } from "./errors";
import {
  closeEffectBoundary,
  createEffectBoundary,
  createEffectBoundaryId,
  effectBoundaryFacet,
  startEffectBoundaryRollback,
} from "./internal/boundary";
import { effectLedger } from "./internal/ledger";
import {
  decideRollbackBoundary,
  type RollbackBoundarySettlement,
  type RollbackCallbackSettlement,
} from "./internal/plan";
import type { RollbackExecution } from "./internal/run-rollback";
import type {
  Awaitable,
  RollbackBoundaryController,
  RollbackOnErrorOptions,
  RollbackOptions,
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
        rollback: async (rollbackOptions?: RollbackOptions) =>
          (
            await startEffectBoundaryRollback(
              boundary,
              rollbackOptions,
            )
          ).result,
      });
      let callback: RollbackCallbackSettlement<T>;
      try {
        callback = {
          kind: "returned",
          value: await run(controller),
        };
      } catch (error) {
        callback = { kind: "threw", error };
      }

      if (boundary.rollbackOperation) {
        const rollback = await settleRollbackOperation(
          boundary.rollbackOperation,
        );
        return applyBoundaryDecision(recovery, callback, rollback);
      }

      if (callback.kind === "returned") {
        closeEffectBoundary(boundary);
        return callback.value;
      }

      const rollback = await settleRollbackOperation(
        startEffectBoundaryRollback(boundary),
      );
      return applyBoundaryDecision(recovery, callback, rollback);
    },
  );
}

async function settleRollbackOperation(
  operation: Promise<RollbackExecution>,
): Promise<RollbackBoundarySettlement> {
  try {
    const execution = await operation;
    return {
      kind: "result",
      result: execution.result,
      ...(execution.recoveryError === undefined
        ? {}
        : { recoveryError: execution.recoveryError }),
    };
  } catch (recoveryError) {
    return { kind: "pre-result-failure", recoveryError };
  }
}

function applyBoundaryDecision<T>(
  recovery: NonNullable<RollbackOnErrorOptions["recovery"]>,
  callback: RollbackCallbackSettlement<T>,
  rollback: RollbackBoundarySettlement,
): T {
  const decision = decideRollbackBoundary(
    recovery,
    callback,
    rollback,
  );
  if (decision.kind === "throw-callback") {
    throw decision.error;
  }
  if (decision.kind === "throw-rollback") {
    throw new RollbackError({
      result: decision.result,
      recoveryError: decision.recoveryError,
      cause: decision.cause,
    });
  }
  if (callback.kind === "returned") {
    return callback.value;
  }
  throw new TypeError("Rollback boundary decision is inconsistent.");
}
