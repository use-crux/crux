/** Memory Effect record cloning and lookup helpers. @internal @module */

import type {
  DurableEffectPreparation,
  DurableEffectReconciliationSettlement,
  DurableEffectReceiptRecord,
  DurableEffectScopeSynchronization,
} from "../../../effect/internal/durable-records";
import {
  durableTransitionMatches,
  isDurableReconciliationReceiptTransition,
  isDurableReconciliationUnitTransition,
  isDurableScopeSynchronization,
  isDurableUnitRegistration,
} from "../../../effect/internal/durable-state-machine";
import type { MemoryRuntimeData, MemoryWriteRecorder } from "./data";
import { scopedKey } from "./data";

export function preparationForExisting(
  data: MemoryRuntimeData,
  requested: DurableEffectPreparation,
  receipt: DurableEffectReceiptRecord,
): DurableEffectPreparation {
  const scope = data.effectScopes.get(
    scopedKey(requested.scope.namespace, requested.scope.scope.ref.id),
  );
  if (!scope) throw new TypeError("Durable Effect scope is missing.");
  const unit = requested.unit
    ? data.effectUnits.get(
        scopedKey(requested.unit.namespace, requested.unit.unit.id),
      )
    : undefined;
  const envelope = requested.envelope
    ? data.effectEnvelopes.get(
        scopedKey(requested.envelope.namespace, requested.envelope.receiptId),
      )
    : undefined;
  return cloneRecord({ scope, receipt, unit, envelope });
}

export function valuesForNamespace<T extends { readonly namespace: string }>(
  records: Map<string, T>,
  namespace: string,
): T[] {
  return [...records.values()].filter((record) => record.namespace === namespace);
}

export function put<K, V>(
  records: Map<K, V>,
  key: K,
  value: V,
  recordWrite?: MemoryWriteRecorder,
): void {
  recordWrite?.();
  records.set(key, value);
}

export function cloneOptional<T>(value: T | undefined): T | null {
  return value === undefined ? null : cloneRecord(value);
}

export function cloneRecord<T>(value: T): T {
  return Object.freeze(structuredClone(value)) as T;
}

export function synchronizeMemoryEffectScope(
  data: MemoryRuntimeData,
  synchronization: DurableEffectScopeSynchronization,
  recordWrite?: MemoryWriteRecorder,
): DurableEffectScopeSynchronization | null {
  const scopeKey = scopedKey(
    synchronization.scope.namespace,
    synchronization.scope.scope.ref.id,
  );
  const currentScope = data.effectScopes.get(scopeKey);
  const currentUnits = synchronization.units.map((unit) =>
    data.effectUnits.get(scopedKey(unit.namespace, unit.unit.id)),
  );
  if (
    !isDurableScopeSynchronization(currentScope, synchronization.scope) ||
    synchronization.units.some(
      (unit, index) =>
        !isDurableUnitRegistration(
          synchronization.scope.scope.ref,
          currentUnits[index],
          unit,
        ),
    )
  ) return null;

  const stored = cloneRecord(synchronization);
  put(data.effectScopes, scopeKey, stored.scope, recordWrite);
  for (const unit of stored.units) {
    put(
      data.effectUnits,
      scopedKey(unit.namespace, unit.unit.id),
      unit,
      recordWrite,
    );
  }
  return cloneRecord(stored);
}

export function reconcileMemoryEffects(
  data: MemoryRuntimeData,
  settlement: DurableEffectReconciliationSettlement,
  recordWrite?: MemoryWriteRecorder,
): DurableEffectReconciliationSettlement | null {
  const targetId = settlement.reconciliation.receiptId;
  const currentReceipts = settlement.receipts.map((record) =>
    data.effectReceipts.get(scopedKey(record.namespace, record.receipt.id)),
  );
  const currentUnit = settlement.unit
    ? data.effectUnits.get(
        scopedKey(settlement.unit.namespace, settlement.unit.unit.id),
      )
    : undefined;
  const currentEnvelope = settlement.envelope
    ? data.effectEnvelopes.get(scopedKey(
        settlement.envelope.namespace,
        settlement.envelope.receiptId,
      ))
    : undefined;
  const auditKey = scopedKey(settlement.reconciliation.namespace, targetId);
  const audits = data.effectReconciliations.get(auditKey) ?? [];
  if (
    settlement.receipts.some((next, index) => {
      const current = currentReceipts[index];
      return !current ||
        !durableTransitionMatches(current, next) ||
        !isDurableReconciliationReceiptTransition(
          current.receipt.outcome,
          next.receipt.outcome,
          next.receipt.id === targetId,
        );
    }) ||
    (settlement.unit &&
      (!currentUnit ||
        !durableTransitionMatches(currentUnit, settlement.unit) ||
        !isDurableReconciliationUnitTransition(
          currentUnit.unit.status,
          settlement.unit.unit.status,
        ))) ||
    (settlement.envelope &&
      (!currentEnvelope ||
        !durableTransitionMatches(currentEnvelope, settlement.envelope))) ||
    settlement.reconciliation.revision !== audits.length + 1
  ) return null;

  const stored = cloneRecord(settlement);
  for (const receipt of stored.receipts) {
    put(
      data.effectReceipts,
      scopedKey(receipt.namespace, receipt.receipt.id),
      receipt,
      recordWrite,
    );
  }
  if (stored.unit) {
    put(
      data.effectUnits,
      scopedKey(stored.unit.namespace, stored.unit.unit.id),
      stored.unit,
      recordWrite,
    );
  }
  if (stored.envelope) {
    put(
      data.effectEnvelopes,
      scopedKey(stored.envelope.namespace, stored.envelope.receiptId),
      stored.envelope,
      recordWrite,
    );
  }
  put(
    data.effectReconciliations,
    auditKey,
    [...audits, stored.reconciliation],
    recordWrite,
  );
  return cloneRecord(stored);
}
