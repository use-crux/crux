/**
 * Pure guards and reconstruction for durable Effect records.
 *
 * @internal
 * @module
 */

import type {
  EffectOutcome,
  EffectScopeLifecycle,
  RecoveryUnitLifecycle,
} from "../receipt-types";
import type { EffectScopeRef } from "../types";
import { planRollback } from "./plan";
import type { RecoveryStackEntry } from "./recovery-stack";
import type {
  DurableEffectEnvelopeRecord,
  DurableEffectPlanStep,
  DurableEffectReceiptRecord,
  DurableEffectReconciliationRecord,
  DurableEffectRecoveryAttemptRecord,
  DurableEffectRecoveryUnitRecord,
  DurableEffectScopeRecord,
  DurableEffectScopeSnapshot,
} from "./durable-records";

/** Records read from one Runtime-store partition for reconstruction. */
export interface DurableEffectScopeRecords {
  readonly scope: DurableEffectScopeRecord;
  readonly receipts: readonly DurableEffectReceiptRecord[];
  readonly units: readonly DurableEffectRecoveryUnitRecord[];
  readonly envelopes: readonly DurableEffectEnvelopeRecord[];
  readonly attempts: readonly DurableEffectRecoveryAttemptRecord[];
  readonly reconciliations: readonly DurableEffectReconciliationRecord[];
}

/** Whether a receipt transition is monotonic and store-admissible. */
export function isDurableReceiptTransition(
  from: EffectOutcome,
  to: EffectOutcome,
): boolean {
  return (
    (from === "preparing" && (to === "running" || to === "failed")) ||
    (from === "running" && isTerminalOutcome(to)) ||
    (from === "unknown" && (to === "succeeded" || to === "failed"))
  );
}

/** Assert the in-process execution transition subset used by the ledger. */
export function assertLedgerReceiptTransition(
  from: EffectOutcome,
  to: Exclude<EffectOutcome, "preparing">,
): void {
  const legal =
    (from === "preparing" && (to === "running" || to === "failed")) ||
    (from === "running" && isTerminalOutcome(to));
  if (!legal) {
    throw new TypeError(
      `Illegal effect receipt transition from \`${from}\` to \`${to}\`.`,
    );
  }
}

/** Whether a recovery-unit transition is monotonic and store-admissible. */
export function isDurableUnitTransition(
  from: RecoveryUnitLifecycle,
  to: RecoveryUnitLifecycle,
): boolean {
  return (
    (from === "prepared" && (to === "active" || to === "failed")) ||
    ((from === "active" || from === "failed") && to === "recovering") ||
    (from === "recovering" && (to === "recovered" || to === "failed"))
  );
}

/** Whether a rollback-scope transition is monotonic and store-admissible. */
export function isDurableScopeTransition(
  from: EffectScopeLifecycle,
  to: EffectScopeLifecycle,
): boolean {
  return (
    (from === "open" && (to === "closed" || to === "rolling_back")) ||
    (from === "closed" && to === "rolling_back") ||
    (from === "rolling_back" && to === "completed")
  );
}

/** Verify optimistic revision and optional lease fence for one update. */
export function durableTransitionMatches(
  current: { readonly revision: number; readonly fenceToken?: string },
  next: { readonly revision: number; readonly fenceToken?: string },
): boolean {
  return (
    next.revision === current.revision + 1 &&
    (current.fenceToken === undefined ||
      next.fenceToken === current.fenceToken)
  );
}

/** Rebuild one exact rollback plan without invoking recovery handlers. */
export function reconstructDurableEffectScope(
  scope: EffectScopeRef,
  records: DurableEffectScopeRecords,
): DurableEffectScopeSnapshot {
  const orderedUnits = [...records.units].sort(
    (left, right) =>
      (left.appendOrder ?? Number.MAX_SAFE_INTEGER) -
      (right.appendOrder ?? Number.MAX_SAFE_INTEGER),
  );
  const stack: RecoveryStackEntry[] = orderedUnits.flatMap(
    (record): readonly RecoveryStackEntry[] => {
      if (record.appendOrder === undefined) return [];
      if (record.kind === "boundary") {
        return [{ kind: "boundary" as const, unitId: record.unit.id }];
      }
      const receiptId = record.unit.receiptIds[0];
      return receiptId
        ? [{ kind: "effect" as const, receiptId }]
        : [];
    },
  );
  const planned = planRollback(
    stack,
    records.receipts.map((record) => record.receipt),
    records.units.map((record) => record.unit),
  );
  const plan = planned.flatMap((step): DurableEffectPlanStep[] => {
    const unitId =
      step.kind === "settle" ? step.result.unitId :
      step.kind === "recover-boundary" ? step.unitId :
      step.cancelled.unitId;
    const unit = records.units.find((candidate) => candidate.unit.id === unitId);
    const receiptId = unit?.unit.receiptIds[0];
    const receipt = records.receipts.find(
      (candidate) => candidate.receipt.id === receiptId,
    );
    if (!unit || !receiptId || !receipt) return [];
    return [{
      unitId,
      receiptId,
      effectId: receipt.receipt.effectId,
      effectVersion: receipt.receipt.effectVersion,
      idempotencyKey: unit.unit.idempotencyKey,
      status: unit.unit.status,
    }];
  });
  return Object.freeze({
    scope,
    scopeRecord: records.scope,
    receipts: Object.freeze([...records.receipts]),
    units: Object.freeze([...orderedUnits]),
    envelopes: Object.freeze([...records.envelopes]),
    attempts: Object.freeze([...records.attempts]),
    reconciliations: Object.freeze([...records.reconciliations]),
    plan: Object.freeze(plan),
  });
}

function isTerminalOutcome(outcome: EffectOutcome): boolean {
  return (
    outcome === "succeeded" ||
    outcome === "failed" ||
    outcome === "cancelled" ||
    outcome === "unknown"
  );
}
