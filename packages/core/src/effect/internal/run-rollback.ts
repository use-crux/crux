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
  type RollbackPlanStep,
} from "./plan";
import type { DurableEffectScopeSnapshot } from "./durable-records";
import { currentDurableEffectLedgerBinding } from "./durable-binding";
import { persistDurableRecoveryUnitTransition } from "./ledger-durable";

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
  durableSnapshot?: DurableEffectScopeSnapshot,
): Promise<RollbackExecution> {
  const startedAt = Date.now();
  const units: RecoveryUnitResult[] = [];
  let recoveryError: unknown;
  const plan = durableSnapshot
    ? rollbackPlanFromDurable(durableSnapshot)
    : planRollback(
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

function rollbackPlanFromDurable(
  snapshot: DurableEffectScopeSnapshot,
): readonly RollbackPlanStep[] {
  return snapshot.plan.map((step): RollbackPlanStep => {
    const unit = snapshot.units.find((record) => record.unit.id === step.unitId);
    const receipt = step.kind === "effect"
      ? snapshot.receipts.find((record) => record.receipt.id === step.receiptId)
          ?.receipt
      : undefined;
    const effectIds = unit?.unit.effectIds ?? (receipt ? [receipt.effectId] : []);
    const result = Object.freeze({
      unitId: step.unitId,
      effectIds,
      ...(receipt?.resource === undefined ? {} : { resource: receipt.resource }),
      status: durableResultStatus(step.status),
    });
    if (step.status !== "active" && step.status !== "failed") {
      return {
        kind: "settle",
        result,
        ...(receipt
          ? {
              receipt: Object.freeze({
                kind: "effect.receipt" as const,
                id: receipt.id,
                effectId: receipt.effectId,
              }),
            }
          : {}),
      };
    }
    return step.kind === "effect"
      ? {
          kind: "recover-effect",
          receipt: Object.freeze({
            kind: "effect.receipt" as const,
            id: step.receiptId,
            effectId: step.effectId,
          }),
          cancelled: { ...result, status: "cancelled" },
        }
      : {
          kind: "recover-boundary",
          unitId: step.unitId,
          cancelled: { ...result, status: "cancelled" },
        };
  });
}

function durableResultStatus(
  status: import("../types").RecoveryUnitStatus | RecoveryUnitLifecycle,
): import("../types").RecoveryUnitStatus {
  if (status === "recovered") return "already_recovered";
  if (status === "prepared" || status === "recovering" || status === "active") {
    return "ambiguous";
  }
  return status;
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
    const binding = currentDurableEffectLedgerBinding();
    const durableSnapshot = binding?.store.effects
      ? await binding.store.effects.reconstructScope(unit.scope, {
          namespace: binding.namespace,
        })
      : undefined;
    await persistDurableRecoveryUnitTransition(unit.id);
    try {
      if (durableSnapshot && binding) {
        effectLedger.restoreDurableSnapshot(durableSnapshot, binding);
      }
      const nested = await runRollback(
        unit.scope,
        options,
        durableSnapshot ?? undefined,
      );
      const status = nestedBoundaryUnitStatus(nested.result);
      const lifecycle = lifecycleFor(status);
      effectLedger.markUnit(unit.id, lifecycle);
      if (lifecycle !== "active") {
        await persistDurableRecoveryUnitTransition(unit.id);
      }
      return {
        result: boundaryUnitResult(unit, status),
        ...(nested.recoveryError === undefined
          ? {}
          : { error: nested.recoveryError }),
      };
    } catch (error) {
      effectLedger.markUnit(unit.id, "failed");
      await persistDurableRecoveryUnitTransition(unit.id);
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
