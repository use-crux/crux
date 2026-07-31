/**
 * Automatic rollback boundaries for custom effects.
 *
 * @module
 */

import { runScope } from "../scope/internal";
import { RollbackError } from "./errors";
import {
  assertEffectBoundaryRollbackAllowed,
  closeEffectBoundary,
  createEffectBoundary,
  createEffectBoundaryId,
  currentEffectBoundary,
  effectBoundaryFacet,
  startEffectBoundaryRollback,
  trackEffectBoundaryOperation,
  waitForEffectBoundaryOperations,
  type EffectBoundaryState,
} from "./internal/boundary";
import { effectLedger } from "./internal/ledger";
import { registerNestedBoundaryUnit } from "./internal/recovery-stack";
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
  const parent = currentEffectBoundary();
  const operation = runScope<T>(
    {
      kind: "effect-boundary",
      id: createEffectBoundaryId(),
    },
    {},
    async (scope) => {
      const boundary = createEffectBoundary(scope, recovery, parent);
      scope.setFacet(effectBoundaryFacet, boundary);
      effectLedger.registerScope({
        ref: boundary.ref,
        ...(parent === undefined ? {} : { parentId: parent.ref.id }),
        status: "open",
        unitIds: [],
      });
      const controller: RollbackBoundaryController = Object.freeze({
        ref: boundary.ref,
        rollback: async (rollbackOptions?: RollbackOptions) => {
          assertEffectBoundaryRollbackAllowed(boundary);
          return (
            await startEffectBoundaryRollback(
              boundary,
              rollbackOptions,
            )
          ).result;
        },
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
        registerWithParent(boundary, rollback);
        return applyBoundaryDecision(recovery, callback, rollback);
      }

      if (callback.kind === "returned") {
        await waitForEffectBoundaryOperations(boundary);
        closeEffectBoundary(boundary);
        registerWithParent(boundary);
        return callback.value;
      }

      const rollback = await settleRollbackOperation(
        startEffectBoundaryRollback(boundary),
      );
      registerWithParent(boundary, rollback);
      return applyBoundaryDecision(recovery, callback, rollback);
    },
  );
  return trackEffectBoundaryOperation(operation, parent);
}

function registerWithParent(
  boundary: EffectBoundaryState,
  rollback?: RollbackBoundarySettlement,
): void {
  if (!boundary.parent) return;
  const status =
    rollback?.kind === "result" &&
    rollback.result.status === "completed"
      ? "recovered"
      : rollback === undefined
        ? "active"
        : "failed";
  registerNestedBoundaryUnit(
    boundary.parent.ref.id,
    boundary.ref,
    status,
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
