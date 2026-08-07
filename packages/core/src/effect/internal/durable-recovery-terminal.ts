/** Terminal durable recovery settlements. @internal @module */

import type { DurableLedgerCache } from "./durable-ledger";
import { currentDurableEffectLedgerBinding } from "./durable-binding";
import {
  durableReceiptRecord,
  durableUnitRecord,
} from "./durable-record-builders";

/** Atomically settle a known failed attempt and recovery unit. */
export async function settleDurableRecoveryFailure(
  cache: DurableLedgerCache,
  input: { readonly attemptReceiptId: string; readonly unitId: string },
): Promise<void> {
  const binding = currentDurableEffectLedgerBinding();
  if (!binding) return;
  const attempt = requireValue(cache.getReceipt(input.attemptReceiptId), "attempt receipt");
  const unit = requireValue(cache.getUnit(input.unitId), "recovery unit");
  const scope = requireValue(cache.getScope(unit.boundaryId), "scope");
  await binding.store.transact(async (tx) => {
    const effects = requireValue(tx.effects, "Effects store port");
    const currentAttempt = requireValue(
      await effects.getReceipt(attempt.id, { namespace: binding.namespace }),
      "durable attempt receipt",
    );
    const snapshot = requireValue(
      await effects.reconstructScope(scope.ref, { namespace: binding.namespace }),
      "durable Effect scope",
    );
    const currentUnit = requireValue(
      snapshot.units.find((record) => record.unit.id === input.unitId),
      "durable recovery unit",
    );
    const settlement = {
      attemptReceipt: {
        ...durableReceiptRecord(
          binding.namespace,
          attempt,
          currentAttempt.executionIdempotencyKey,
          currentAttempt.revision + 1,
        ),
        ...(currentAttempt.fenceToken
          ? { fenceToken: currentAttempt.fenceToken }
          : {}),
      },
      unit: {
        ...durableUnitRecord(
          binding.namespace,
          unit,
          currentUnit.effectVersion ?? attempt.effectVersion,
          currentUnit.revision + 1,
          currentUnit.appendOrder,
        ),
        ...(currentUnit.fenceToken
          ? { fenceToken: currentUnit.fenceToken }
          : {}),
      },
    };
    if (!(await effects.settleRecoveryFailure(settlement))) {
      throw new TypeError(
        `Durable recovery attempt \`${attempt.id}\` rejected failed settlement.`,
      );
    }
  });
}

/** Persist an exact program-resolution miss without invoking recovery. */
export async function settleDurableRecoveryUnavailable(
  cache: DurableLedgerCache,
  input: { readonly receiptId: string; readonly unitId: string },
): Promise<void> {
  const binding = currentDurableEffectLedgerBinding();
  if (!binding) return;
  const receipt = requireValue(cache.getReceipt(input.receiptId), "receipt");
  const unit = requireValue(cache.getUnit(input.unitId), "recovery unit");
  const scope = requireValue(cache.getScope(receipt.boundaryId), "scope");
  await binding.store.transact(async (tx) => {
    const effects = requireValue(tx.effects, "Effects store port");
    const currentReceipt = requireValue(
      await effects.getReceipt(receipt.id, { namespace: binding.namespace }),
      "durable receipt",
    );
    const snapshot = requireValue(
      await effects.reconstructScope(scope.ref, { namespace: binding.namespace }),
      "durable Effect scope",
    );
    const currentUnit = requireValue(
      snapshot.units.find((record) => record.unit.id === unit.id),
      "durable recovery unit",
    );
    const settlement = {
      receipt: {
        ...durableReceiptRecord(
          binding.namespace,
          receipt,
          currentReceipt.executionIdempotencyKey,
          currentReceipt.revision + 1,
          currentReceipt.appendOrder,
        ),
        ...(currentReceipt.fenceToken
          ? { fenceToken: currentReceipt.fenceToken }
          : {}),
      },
      unit: {
        ...durableUnitRecord(
          binding.namespace,
          unit,
          currentUnit.effectVersion ?? receipt.effectVersion,
          currentUnit.revision + 1,
          currentUnit.appendOrder,
        ),
        ...(currentUnit.fenceToken
          ? { fenceToken: currentUnit.fenceToken }
          : {}),
      },
    };
    if (!(await effects.settleRecoveryUnavailable(settlement))) {
      throw new TypeError(
        `Durable recovery unit \`${unit.id}\` rejected unavailable settlement.`,
      );
    }
  });
}

function requireValue<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) {
    throw new TypeError(`Missing ${label}.`);
  }
  return value;
}
