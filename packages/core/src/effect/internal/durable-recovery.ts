/** Atomic durable recovery-attempt writes owned by the Effect ledger. @internal @module */

import type { DurableLedgerCache } from "./durable-ledger";
import { currentDurableEffectLedgerBinding } from "./durable-binding";
import {
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

function requireValue<T>(value: T | null | undefined, name: string): T {
  if (value === null || value === undefined) {
    throw new TypeError(`${name} is unavailable.`);
  }
  return value;
}
