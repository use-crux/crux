/**
 * In-process execution of a pure rollback plan.
 *
 * @internal
 * @module
 */

import type {
  EffectScopeRef,
  RecoveryUnitResult,
  RecoveryUnitStatus,
  RollbackOptions,
  RollbackResult,
} from "../types";
import type { RecoveryUnitLifecycle } from "../receipt-types";
import { recoverEffectReceiptAttempt } from "../recover";
import { effectLedger } from "./ledger";
import {
  aggregateRollbackStatus,
  planRollback,
} from "./plan";

/**
 * Rollback settlement plus a raw handler error when one occurred.
 *
 * @internal
 */
export interface RollbackExecution {
  /** Aggregate public result. */
  readonly result: RollbackResult;
  /** First raw recovery-handler failure. */
  readonly recoveryError?: unknown;
}

/** Execute every safe unit in a boundary in causal LIFO order. */
export async function runRollback(
  scope: EffectScopeRef,
  options?: RollbackOptions,
): Promise<RollbackExecution> {
  const startedAt = Date.now();
  const units: RecoveryUnitResult[] = [];
  let recoveryError: unknown;
  const plan = planRollback(
    effectLedger.stackFor(scope.id),
    effectLedger.receiptsFor(scope.id),
    effectLedger.unitsFor(scope.id),
  );

  for (const [index, step] of plan.entries()) {
    if (options?.signal?.aborted) {
      units.push(
        ...plan
          .slice(index)
          .map((pending) =>
            pending.kind === "settle"
              ? pending.result
              : pending.cancelled,
          ),
      );
      break;
    }
    if (step.kind === "settle") {
      units.push(step.result);
      continue;
    }
    const attempt =
      step.kind === "recover-effect"
        ? await recoverEffectReceiptAttempt(step.receipt, options)
        : await recoverBoundaryUnitAttempt(step.unitId, options);
    units.push(attempt.result);
    if (attempt.error !== undefined && recoveryError === undefined) {
      recoveryError = attempt.error;
    }
  }

  const result: RollbackResult = Object.freeze({
    scope,
    status: aggregateRollbackStatus(units),
    units: Object.freeze(units),
    startedAt,
    completedAt: Date.now(),
  });
  synchronizeParentBoundaryUnit(scope, result);
  return Object.freeze({
    result,
    ...(recoveryError === undefined ? {} : { recoveryError }),
  });
}

async function recoverBoundaryUnitAttempt(
  unitId: string,
  options?: RollbackOptions,
): Promise<{
  readonly result: RecoveryUnitResult;
  readonly error?: unknown;
}> {
  const unit = effectLedger.getUnit(unitId);
  if (!unit || unit.kind !== "boundary") {
    throw new TypeError(
      `Nested effect boundary unit \`${unitId}\` was not found.`,
    );
  }
  if (unit.status === "recovered") {
    return {
      result: boundaryUnitResult(unit, "already_recovered"),
    };
  }
  if (unit.recoveryOperation) {
    return unit.recoveryOperation;
  }
  const operation = (async () => {
    try {
      const nested = await runRollback(unit.scope, options);
      const status = nestedBoundaryUnitStatus(nested.result);
      effectLedger.markUnit(unit.id, lifecycleFor(status));
      return {
        result: boundaryUnitResult(unit, status),
        ...(nested.recoveryError === undefined
          ? {}
          : { error: nested.recoveryError }),
      };
    } catch (error) {
      effectLedger.markUnit(unit.id, "failed");
      return {
        result: boundaryUnitResult(unit, "failed"),
        error,
      };
    }
  })();
  effectLedger.markUnit(unit.id, "recovering", operation);
  return operation;
}

function synchronizeParentBoundaryUnit(
  scope: EffectScopeRef,
  result: RollbackResult,
): void {
  const unit = effectLedger.getUnit(
    `effect-boundary-unit:${scope.id}`,
  );
  if (
    !unit ||
    unit.kind !== "boundary" ||
    unit.status === "recovering"
  ) {
    return;
  }
  effectLedger.markUnit(
    unit.id,
    lifecycleFor(nestedBoundaryUnitStatus(result)),
  );
}

function nestedBoundaryUnitStatus(
  result: RollbackResult,
): RecoveryUnitStatus {
  if (result.status === "completed") return "recovered";
  if (result.status === "cancelled") return "cancelled";
  if (
    result.status === "failed" ||
    result.units.some((unit) => unit.status === "failed")
  ) {
    return "failed";
  }
  return (
    result.units.find(
      (unit) =>
        unit.status !== "recovered" &&
        unit.status !== "already_recovered",
    )?.status ?? "failed"
  );
}

function lifecycleFor(
  status: RecoveryUnitStatus,
): RecoveryUnitLifecycle {
  if (status === "recovered") return "recovered";
  if (status === "failed") return "failed";
  return "active";
}

function boundaryUnitResult(
  unit: NonNullable<ReturnType<typeof effectLedger.getUnit>>,
  status: RecoveryUnitResult["status"],
): RecoveryUnitResult {
  return Object.freeze({
    unitId: unit.id,
    effectIds: unit.effectIds,
    status,
  });
}
