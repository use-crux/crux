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
  DurableEffectReconciliationRequirement,
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
/** Whether a program-resolution miss may settle an otherwise runnable receipt. */
export function isDurableRecoveryUnavailableReceiptTransition(
  from: DurableEffectReceiptRecord["receipt"],
  to: DurableEffectReceiptRecord["receipt"],
): boolean {
  return (
    from.outcome === "succeeded" &&
    to.outcome === "succeeded" &&
    from.recovery === "available" &&
    to.recovery === "handler_unavailable"
  );
}

/** Whether a program-resolution miss may terminalize a runnable unit. */
export function isDurableRecoveryUnavailableUnitTransition(
  from: RecoveryUnitLifecycle,
  to: RecoveryUnitLifecycle,
): boolean {
  return (from === "active" || from === "failed") && to === "failed";
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
/** Whether an audited reconciliation may replace one durable receipt row. */
export function isDurableReconciliationReceiptTransition(
  from: EffectOutcome,
  to: EffectOutcome,
  target: boolean,
): boolean {
  if (target) {
    return (
      (from === "running" || from === "unknown") &&
      (to === "succeeded" || to === "failed")
    );
  }
  return from === to;
}
/** Whether an audited reconciliation may settle its recovery unit. */
export function isDurableReconciliationUnitTransition(
  from: RecoveryUnitLifecycle,
  to: RecoveryUnitLifecycle,
): boolean {
  return (
    (from === "prepared" && (to === "active" || to === "failed")) ||
    (from === "recovering" && (to === "recovered" || to === "active"))
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
/** Whether a synchronized scope row is a legal insert or transition. */
export function isDurableScopeSynchronization(
  current: DurableEffectScopeRecord | undefined,
  next: DurableEffectScopeRecord,
): boolean {
  return current === undefined
    ? next.revision === 1
    : durableTransitionMatches(current, next) &&
        isDurableScopeTransition(current.scope.status, next.scope.status);
}
/** Whether a newly discovered nested unit is an insert-only row. */
export function isDurableUnitRegistration(
  scope: EffectScopeRef,
  current: DurableEffectRecoveryUnitRecord | undefined,
  next: DurableEffectRecoveryUnitRecord,
): boolean {
  return (
    current === undefined &&
    next.revision === 1 &&
    next.unit.boundaryId === scope.id
  );
}
/** Rebuild one exact rollback plan without invoking recovery handlers. */
export function reconstructDurableEffectScope(
  scope: EffectScopeRef,
  records: DurableEffectScopeRecords,
): DurableEffectScopeSnapshot {
  const receipts = projectCrashHonestReceipts(records);
  const orderedUnits = [...records.units].sort((left, right) =>
    (left.appendOrder ?? Number.MAX_SAFE_INTEGER) -
    (right.appendOrder ?? Number.MAX_SAFE_INTEGER));
  const orderedEntries = [
    ...orderedUnits.flatMap((record) => record.appendOrder === undefined
      ? []
      : [{ order: record.appendOrder, unit: record }]),
    ...receipts.flatMap((record) =>
      record.appendOrder === undefined ||
      records.units.some((unit) => unit.unit.receiptIds.includes(record.receipt.id))
        ? []
        : [{ order: record.appendOrder, receipt: record }],
    ),
  ].sort((left, right) => left.order - right.order);
  const stack: RecoveryStackEntry[] = orderedEntries.flatMap(
    (entry): readonly RecoveryStackEntry[] => {
      if ("receipt" in entry) return [{
        kind: "effect",
        receiptId: entry.receipt.receipt.id,
      }];
      const record = entry.unit;
      if (record.kind === "boundary") return [{
        kind: "boundary" as const,
        unitId: record.unit.id,
      }];
      const receiptId = record.unit.receiptIds[0];
      return receiptId
        ? [{ kind: "effect" as const, receiptId }]
        : [];
    },
  );
  const planned = planRollback(
    stack,
    receipts.map((record) => record.receipt),
    records.units.map((record) => record.unit),
  );
  const plan = planned.flatMap((step): DurableEffectPlanStep[] => {
    const unitId = step.kind === "settle" ? step.result.unitId :
      step.kind === "recover-boundary" ? step.unitId :
      step.cancelled.unitId;
    const unit = records.units.find((candidate) => candidate.unit.id === unitId);
    if (unit?.kind === "boundary" && unit.scope) {
      return [{
        kind: "boundary",
        unitId,
        scope: unit.scope,
        idempotencyKey: unit.unit.idempotencyKey,
        status: step.kind === "settle" ? step.result.status : unit.unit.status,
      }];
    }
    const receiptId = step.kind === "recover-effect"
      ? step.receipt.id
      : step.kind === "settle" && step.receipt
        ? step.receipt.id
        : unit?.unit.receiptIds[0];
    const receipt = receipts.find((candidate) =>
      candidate.receipt.id === receiptId);
    if (!receiptId || !receipt) return [];
    return [{
      kind: "effect",
      unitId,
      receiptId,
      effectId: receipt.receipt.effectId,
      effectVersion: receipt.receipt.effectVersion,
      idempotencyKey:
        unit?.unit.idempotencyKey ?? receipt.executionIdempotencyKey,
      status: step.kind === "settle"
        ? step.result.status
        : unit?.unit.status ?? "active",
    }];
  });
  const reconciliationRequired = records.receipts.flatMap(
    (stored): DurableEffectReconciliationRequirement[] => {
      const projected = receipts.find(
        (record) => record.receipt.id === stored.receipt.id,
      );
      const common = {
        receiptId: stored.receipt.id,
        idempotencyKey: stored.executionIdempotencyKey,
      };
      if (stored.receipt.outcome === "preparing") {
        return [{ kind: "execution", state: "prepared", ...common }];
      }
      if (
        projected?.receipt.outcome !== "unknown" ||
        (stored.receipt.outcome !== "running" &&
          stored.receipt.outcome !== "unknown")
      ) return [];
      return stored.receipt.parentReceiptId && stored.receipt.recoveryUnitId
        ? [{
            kind: "recovery",
            state: "unknown",
            originalReceiptId: stored.receipt.parentReceiptId,
            unitId: stored.receipt.recoveryUnitId,
            ...common,
          }]
        : [{ kind: "execution", state: "unknown", ...common }];
    },
  );
  return Object.freeze({
    scope,
    scopeRecord: records.scope,
    receipts: Object.freeze(receipts),
    units: Object.freeze([...orderedUnits]),
    envelopes: Object.freeze([...records.envelopes]),
    attempts: Object.freeze([...records.attempts]),
    reconciliations: Object.freeze([...records.reconciliations]),
    plan: Object.freeze(plan),
    reconciliationRequired: Object.freeze(reconciliationRequired),
  });
}

function projectCrashHonestReceipts(
  records: DurableEffectScopeRecords,
): DurableEffectReceiptRecord[] {
  const projected = records.receipts.map((record) => {
    if (record.receipt.outcome !== "running") return record;
    const unit = records.units.find((candidate) =>
      candidate.unit.receiptIds.includes(record.receipt.id),
    );
    return Object.freeze({
      ...record,
      receipt: Object.freeze({
        ...record.receipt,
        outcome: "unknown" as const,
        recovery: "ambiguous" as const,
        ...(record.receipt.recoveryUnitId || !unit
          ? {}
          : { recoveryUnitId: unit.unit.id }),
      }),
    });
  });
  const ambiguousOriginalIds = new Set(
    projected.flatMap((record) =>
      record.receipt.parentReceiptId && record.receipt.outcome === "unknown"
        ? [record.receipt.parentReceiptId]
        : [],
    ),
  );
  return projected.map((record) =>
    ambiguousOriginalIds.has(record.receipt.id)
      ? Object.freeze({
          ...record,
          receipt: Object.freeze({
            ...record.receipt,
            recovery: "ambiguous" as const,
          }),
        })
      : record,
  );
}

function isTerminalOutcome(outcome: EffectOutcome): boolean {
  return ["succeeded", "failed", "cancelled", "unknown"].includes(outcome);
}
