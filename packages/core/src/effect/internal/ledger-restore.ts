/** Durable snapshot hydration for the in-process ledger cache. @internal @module */

import type {
  EffectReceipt,
  EffectScopeRecord,
  RecoveryUnitRecord,
} from "../receipt-types";
import type { DurableEffectScopeSnapshot } from "./durable-records";
import type { DurableEffectLedgerBinding } from "./durable-binding";
import type {
  RecoveryStackEntry,
  RegisteredRecoveryUnit,
  StoredRecoveryEnvelope,
} from "./recovery-stack";

/** Mutable cache maps exclusively owned by the Effect ledger. */
export interface LedgerRestoreState {
  readonly receipts: Map<string, EffectReceipt>;
  readonly envelopes: Map<string, StoredRecoveryEnvelope>;
  readonly scopes: Map<string, EffectScopeRecord>;
  readonly units: Map<string, RegisteredRecoveryUnit>;
  readonly unitIdsByBoundary: Map<string, string[]>;
  readonly stacksByBoundary: Map<string, RecoveryStackEntry[]>;
}

/** Replace one boundary cache projection with its durable read model. */
export function restoreDurableLedgerSnapshot(
  snapshot: DurableEffectScopeSnapshot,
  state: LedgerRestoreState,
  binding?: DurableEffectLedgerBinding,
): void {
  state.scopes.set(snapshot.scope.id, snapshot.scopeRecord.scope);
  for (const record of snapshot.receipts) {
    state.receipts.set(record.receipt.id, record.receipt);
  }
  const restoredUnitIds: string[] = [];
  for (const record of snapshot.units) {
    const cached = state.units.get(record.unit.id);
    const liveEffect =
      record.kind === "effect" &&
      cached?.kind === "effect" &&
      binding &&
      cached.handlerBinding?.namespace === binding.namespace &&
      cached.handlerBinding.store === binding.store &&
      cached.handlerBinding.effectVersion === record.effectVersion &&
      sameUnitIdentity(cached, record.unit)
        ? cached
        : undefined;
    const restored: RegisteredRecoveryUnit | undefined =
      record.kind === "boundary" && record.scope
        ? Object.freeze({
            kind: "boundary" as const,
            ...record.unit,
            scope: record.scope,
          })
        : record.kind === "effect"
          ? Object.freeze({
              kind: "effect" as const,
              ...record.unit,
              ...(liveEffect?.execute
                ? {
                    execute: liveEffect.execute,
                    handlerBinding: liveEffect.handlerBinding,
                  }
                : {}),
              ...(liveEffect?.recoveryOperation
                ? { recoveryOperation: liveEffect.recoveryOperation }
                : {}),
            })
          : undefined;
    if (!restored) continue;
    state.units.set(
      record.unit.id,
      cached?.kind === "boundary" && restored.kind === "boundary"
        ? Object.freeze({ ...cached, ...restored })
        : restored,
    );
    restoredUnitIds.push(record.unit.id);
  }
  state.unitIdsByBoundary.set(snapshot.scope.id, restoredUnitIds);
  state.stacksByBoundary.set(
    snapshot.scope.id,
    snapshot.units.flatMap((record): readonly RecoveryStackEntry[] => {
      if (record.appendOrder === undefined || !state.units.has(record.unit.id)) {
        return [];
      }
      if (record.kind === "boundary") {
        return [{ kind: "boundary", unitId: record.unit.id }];
      }
      const receiptId = record.unit.receiptIds[0];
      return receiptId ? [{ kind: "effect", receiptId }] : [];
    }),
  );
  const retainedEnvelopeIds = new Set(
    snapshot.envelopes.map((record) => record.receiptId),
  );
  for (const record of snapshot.receipts) {
    if (!retainedEnvelopeIds.has(record.receipt.id)) {
      state.envelopes.delete(record.receipt.id);
    }
  }
  for (const record of snapshot.envelopes) {
    if (!record.durable || !record.envelope) continue;
    state.envelopes.set(record.receiptId, Object.freeze({
      schemaVersion: 1,
      receiptId: record.envelope.receiptId,
      effectId: record.envelope.effectId,
      effectVersion: record.envelope.effectVersion,
      input: record.envelope.input,
      output: record.envelope.output,
      ...(record.envelope.captured === undefined
        ? {}
        : { captured: record.envelope.captured }),
      createdAt: record.envelope.createdAt,
      durable: true,
    }));
  }
}

function sameUnitIdentity(
  cached: RegisteredRecoveryUnit,
  durable: RecoveryUnitRecord,
): boolean {
  return (
    cached.id === durable.id &&
    cached.boundaryId === durable.boundaryId &&
    cached.idempotencyKey === durable.idempotencyKey &&
    sameValues(cached.receiptIds, durable.receiptIds) &&
    sameValues(cached.effectIds, durable.effectIds)
  );
}

function sameValues(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
