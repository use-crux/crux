/** Atomic durable recovery-attempt writes owned by the Effect ledger. @internal @module */

import type { DurableLedgerCache } from "./durable-ledger";
import type { ReconciliationCommit } from "./reconcile";
import { currentDurableEffectLedgerBinding } from "./durable-binding";
import {
  durableEnvelopeRecord,
  durableReceiptRecord,
  durableUnitRecord,
} from "./durable-record-builders";

/** Persist an attempt receipt and recovering-unit fence before compensation. */
export async function prepareDurableRecoveryAttempt(
  cache: DurableLedgerCache,
  input: {
    readonly attemptReceiptId: string;
    readonly originalReceiptId: string;
    readonly unitId: string;
  },
): Promise<void> {
  const binding = currentDurableEffectLedgerBinding();
  if (!binding) return;
  const attempt = requireValue(cache.getReceipt(input.attemptReceiptId), "attempt receipt");
  const original = requireValue(cache.getReceipt(input.originalReceiptId), "original receipt");
  const unit = requireValue(cache.getUnit(input.unitId), "recovery unit");
  const scope = requireValue(cache.getScope(original.boundaryId), "scope");
  await binding.store.transact(async (tx) => {
    const effects = requireValue(tx.effects, "Effects store port");
    const snapshot = requireValue(
      await effects.reconstructScope(scope.ref, { namespace: binding.namespace }),
      "durable Effect scope",
    );
    const currentUnit = requireValue(
      snapshot.units.find((record) => record.unit.id === input.unitId),
      "durable recovery unit",
    );
    const prepared = {
      attempt: {
        namespace: binding.namespace,
        attemptReceiptId: attempt.id,
        originalReceiptId: original.id,
        unitId: unit.id,
        revision: 1,
      },
      receipt: durableReceiptRecord(
        binding.namespace,
        attempt,
        unit.idempotencyKey,
        1,
      ),
      unit: durableUnitRecord(
        binding.namespace,
        unit,
        currentUnit.effectVersion ?? original.effectVersion,
        currentUnit.revision + 1,
        currentUnit.appendOrder,
      ),
    };
    if (!(await effects.prepareRecovery(prepared))) {
      throw new TypeError(`Durable recovery attempt \`${attempt.id}\` was rejected.`);
    }
  });
}

/** Atomically settle a successful attempt, original receipt, and unit. */
export async function settleDurableRecoveryAttempt(
  cache: DurableLedgerCache,
  input: {
    readonly attemptReceiptId: string;
    readonly originalReceiptId: string;
    readonly unitId: string;
  },
): Promise<void> {
  const binding = currentDurableEffectLedgerBinding();
  if (!binding) return;
  const attempt = requireValue(cache.getReceipt(input.attemptReceiptId), "attempt receipt");
  const original = requireValue(cache.getReceipt(input.originalReceiptId), "original receipt");
  const unit = requireValue(cache.getUnit(input.unitId), "recovery unit");
  const scope = requireValue(cache.getScope(original.boundaryId), "scope");
  await binding.store.transact(async (tx) => {
    const effects = requireValue(tx.effects, "Effects store port");
    const currentAttempt = requireValue(
      await effects.getReceipt(attempt.id, { namespace: binding.namespace }),
      "durable attempt receipt",
    );
    const currentOriginal = requireValue(
      await effects.getReceipt(original.id, { namespace: binding.namespace }),
      "durable original receipt",
    );
    const snapshot = requireValue(
      await effects.reconstructScope(scope.ref, { namespace: binding.namespace }),
      "durable Effect scope",
    );
    const currentUnit = requireValue(
      snapshot.units.find((record) => record.unit.id === input.unitId),
      "durable recovery unit",
    );
    const settled = {
      attemptReceipt: durableReceiptRecord(
        binding.namespace,
        attempt,
        currentAttempt.executionIdempotencyKey,
        currentAttempt.revision + 1,
      ),
      originalReceipt: durableReceiptRecord(
        binding.namespace,
        original,
        currentOriginal.executionIdempotencyKey,
        currentOriginal.revision + 1,
      ),
      unit: durableUnitRecord(
        binding.namespace,
        unit,
        currentUnit.effectVersion ?? original.effectVersion,
        currentUnit.revision + 1,
        currentUnit.appendOrder,
      ),
    };
    if (!(await effects.settleRecovery(settled))) {
      throw new TypeError(`Durable recovery attempt \`${attempt.id}\` rejected settlement.`);
    }
  });
}

/** Persist an operator reconciliation before committing it to the cache. */
export async function persistDurableEffectReconciliation(
  cache: DurableLedgerCache,
  change: ReconciliationCommit,
): Promise<void> {
  const binding = currentDurableEffectLedgerBinding();
  if (!binding) return;
  const target = requireValue(cache.getReceipt(change.audit.receiptId), "receipt");
  const scope = requireValue(cache.getScope(target.boundaryId), "scope");
  await binding.store.transact(async (tx) => {
    const effects = requireValue(tx.effects, "Effects store port");
    const snapshot = requireValue(
      await effects.reconstructScope(scope.ref, { namespace: binding.namespace }),
      "durable Effect scope",
    );
    const receipts = await Promise.all(change.receipts.map(async (receipt) => {
      const current = requireValue(
        await effects.getReceipt(receipt.id, { namespace: binding.namespace }),
        "durable receipt",
      );
      return {
        ...durableReceiptRecord(
          binding.namespace,
          receipt,
          current.executionIdempotencyKey,
          current.revision + 1,
        ),
        ...(current.fenceToken ? { fenceToken: current.fenceToken } : {}),
      };
    }));
    const reconciledUnit = change.unit ?? (change.discardUnit
      ? Object.freeze({ ...change.discardUnit, status: "failed" as const })
      : undefined);
    const currentUnit = reconciledUnit
      ? requireValue(
          snapshot.units.find((record) => record.unit.id === reconciledUnit.id),
          "durable recovery unit",
        )
      : undefined;
    const appendOrder = currentUnit?.appendOrder ??
      (reconciledUnit?.status === "active"
        ? Math.max(0, ...snapshot.units.map((record) => record.appendOrder ?? 0)) + 1
        : undefined);
    const currentEnvelope = change.envelope
      ? requireValue(
          snapshot.envelopes.find(
            (record) => record.receiptId === change.envelope?.receiptId,
          ),
          "durable recovery envelope",
        )
      : undefined;
    const settlement = {
      reconciliation: {
        namespace: binding.namespace,
        ...change.audit,
        revision:
          snapshot.reconciliations.filter(
            (record) => record.receiptId === change.audit.receiptId,
          ).length + 1,
      },
      receipts,
      ...(reconciledUnit && currentUnit
        ? {
            unit: {
              ...durableUnitRecord(
                binding.namespace,
                reconciledUnit,
                currentUnit.effectVersion ?? target.effectVersion,
                currentUnit.revision + 1,
                appendOrder,
              ),
              ...(currentUnit.fenceToken
                ? { fenceToken: currentUnit.fenceToken }
                : {}),
            },
          }
        : {}),
      ...(change.envelope && currentEnvelope
        ? {
            envelope: durableEnvelopeRecord(
              binding.namespace,
              change.envelope,
              currentEnvelope.revision + 1,
            ),
          }
        : {}),
    };
    if (!(await effects.reconcile(settlement))) {
      throw new TypeError(
        `Durable Effect receipt \`${change.audit.receiptId}\` rejected reconciliation.`,
      );
    }
  });
}

function requireValue<T>(value: T | null | undefined, name: string): T {
  if (value === null || value === undefined) {
    throw new TypeError(`${name} is unavailable.`);
  }
  return value;
}
