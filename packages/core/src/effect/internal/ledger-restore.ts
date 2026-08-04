/** Durable snapshot hydration for the in-process ledger cache. @internal @module */

import type { EffectReceipt, EffectScopeRecord } from "../receipt-types";
import type { DurableEffectScopeSnapshot } from "./durable-records";
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
): void {
  state.scopes.set(snapshot.scope.id, snapshot.scopeRecord.scope);
  for (const record of snapshot.receipts) {
    state.receipts.set(record.receipt.id, record.receipt);
  }
  const restoredUnitIds: string[] = [];
  for (const record of snapshot.units) {
    const cached = state.units.get(record.unit.id);
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
              ...(cached?.recoveryOperation
                ? { recoveryOperation: cached.recoveryOperation }
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
