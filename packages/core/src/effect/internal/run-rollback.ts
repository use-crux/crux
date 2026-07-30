/**
 * In-process execution of a pure rollback plan.
 *
 * @internal
 * @module
 */

import type {
  EffectScopeRef,
  RecoveryUnitResult,
  RollbackOptions,
  RollbackResult,
} from "../types";
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
    effectLedger.receiptsFor(scope.id),
    effectLedger.unitsFor(scope.id),
  );

  for (const step of plan) {
    if (step.kind === "settle") {
      units.push(step.result);
      continue;
    }
    const attempt = await recoverEffectReceiptAttempt(
      step.receipt,
      options,
    );
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
  return Object.freeze({
    result,
    ...(recoveryError === undefined ? {} : { recoveryError }),
  });
}
