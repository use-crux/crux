/** Durable write-through operations owned by the Effect ledger. @internal @module */

import type {
  EffectReceipt,
  EffectScopeRecord,
} from "../receipt-types";
import type { EffectScopeRef } from "../types";
import type { EvidenceArtifactRef } from "../../evidence/subjects";
import type { DurableEffectScopeSnapshot } from "./durable-records";
import type {
  RecoveryStackEntry,
  RegisteredRecoveryUnit,
  StoredRecoveryEnvelope,
} from "./recovery-stack";
import {
  currentDurableEffectLedgerBinding,
  type DurableEffectLedgerBinding,
} from "./durable-binding";
import {
  durableEnvelopeRecord,
  durableReceiptRecord,
  durableUnitRecord,
} from "./durable-record-builders";

/** Cache access retained by the ledger while durable records are authoritative. */
export interface DurableLedgerCache {
  getReceipt(id: string): EffectReceipt | undefined;
  getScope(id: string): EffectScopeRecord | undefined;
  getUnit(id: string): RegisteredRecoveryUnit | undefined;
  getEnvelope(id: string): StoredRecoveryEnvelope | undefined;
  stackFor(boundaryId: string): readonly RecoveryStackEntry[];
  restore(
    snapshot: DurableEffectScopeSnapshot,
    binding?: DurableEffectLedgerBinding,
  ): void;
}

/** Whether the current execution has a durable Effects-capable Runtime store. */
export function hasDurableEffectStore(): boolean {
  return currentDurableEffectLedgerBinding() !== undefined;
}

/** Atomically insert the prepared occurrence before its executor starts. */
export async function prepareDurableEffectExecution(
  cache: DurableLedgerCache,
  input: {
    readonly receiptId: string;
    readonly executionIdempotencyKey: string;
    readonly recoveryUnitId?: string;
  },
): Promise<void> {
  const binding = currentDurableEffectLedgerBinding();
  if (!binding) return;
  const receipt = requireValue(cache.getReceipt(input.receiptId), "receipt");
  const scope = requireValue(cache.getScope(receipt.boundaryId), "scope");
  const unit = input.recoveryUnitId
    ? cache.getUnit(input.recoveryUnitId)
    : undefined;
  const envelope = cache.getEnvelope(receipt.id);
  const current = await binding.store.effects?.reconstructScope(scope.ref, {
    namespace: binding.namespace,
  });
  const preparation = {
    scope: {
      namespace: binding.namespace,
      scope: Object.freeze({
        ...scope,
        unitIds: unit
          ? Object.freeze([...new Set([...scope.unitIds, unit.id])])
          : scope.unitIds,
      }),
      revision: (current?.scopeRecord.revision ?? 0) + 1,
    },
    receipt: durableReceiptRecord(
      binding.namespace,
      receipt,
      input.executionIdempotencyKey,
      1,
    ),
    ...(unit
      ? {
          unit: durableUnitRecord(
            binding.namespace,
            unit,
            receipt.effectVersion,
            1,
          ),
        }
      : {}),
    ...(envelope
      ? { envelope: durableEnvelopeRecord(binding.namespace, envelope, 1) }
      : {}),
  };
  await binding.store.transact(async (tx) => {
    const effects = requireValue(tx.effects, "Effects store port");
    await effects.prepare(preparation);
  });
}

/** Persist the cache's current receipt lifecycle after execution has entered. */
export async function persistDurableReceiptTransition(
  cache: DurableLedgerCache,
  receiptId: string,
): Promise<void> {
  const binding = currentDurableEffectLedgerBinding();
  if (!binding) return;
  const receipt = requireValue(cache.getReceipt(receiptId), "receipt");
  await binding.store.transact(async (tx) => {
    const effects = requireValue(tx.effects, "Effects store port");
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const current = requireValue(
        await effects.getReceipt(receiptId, { namespace: binding.namespace }),
        "durable receipt",
      );
      const expired = current.receipt.recovery === "expired";
      const next = durableReceiptRecord(
        binding.namespace,
        expired
          ? Object.freeze({ ...receipt, recovery: "expired" })
          : receipt,
        current.executionIdempotencyKey,
        current.revision + 1,
      );
      if (await effects.transitionReceipt({ next })) {
        return;
      }
      const latest = await effects.getReceipt(receiptId, {
        namespace: binding.namespace,
      });
      if (latest?.receipt.recovery !== "expired") break;
    }
    throw new TypeError(`Durable Effect receipt \`${receiptId}\` rejected its transition.`);
  });
}

/** Append canonical tool-outcome evidence to a settled durable receipt. */
export async function linkDurableEffectReceiptEvidence(
  receiptId: string,
  ref: EvidenceArtifactRef,
): Promise<void> {
  const binding = currentDurableEffectLedgerBinding();
  if (!binding) return;
  await binding.store.transact(async (tx) => {
    const effects = requireValue(tx.effects, "Effects store port");
    const current = requireValue(
      await effects.getReceipt(receiptId, { namespace: binding.namespace }),
      "durable receipt",
    );
    if (!(await effects.linkReceiptEvidence({
      namespace: binding.namespace,
      receiptId,
      revision: current.revision,
      toolOutcomeRef: ref,
    }))) {
      throw new TypeError(
        `Durable Effect receipt \`${receiptId}\` rejected evidence linkage.`,
      );
    }
  });
}

/** Update a receipt from the final retry count inspected after SDK settlement. */
export async function linkDurableEffectReceiptRetryCount(
  receiptId: string,
  requestRetryCount: number,
): Promise<void> {
  const binding = currentDurableEffectLedgerBinding();
  if (!binding) return;
  await binding.store.transact(async (tx) => {
    const effects = requireValue(tx.effects, "Effects store port");
    const current = requireValue(
      await effects.getReceipt(receiptId, { namespace: binding.namespace }),
      "durable receipt",
    );
    if (!(await effects.linkReceiptEvidence({
      namespace: binding.namespace,
      receiptId,
      revision: current.revision,
      requestRetryCount,
    }))) {
      throw new TypeError(
        `Durable Effect receipt \`${receiptId}\` rejected retry linkage.`,
      );
    }
  });
}

/** Atomically settle a successful execution, envelope, and active unit. */
export async function settleDurableEffectExecution(
  cache: DurableLedgerCache,
  receiptId: string,
): Promise<void> {
  const binding = currentDurableEffectLedgerBinding();
  if (!binding) return;
  const receipt = requireValue(cache.getReceipt(receiptId), "receipt");
  const scope = requireValue(cache.getScope(receipt.boundaryId), "scope");
  await binding.store.transact(async (tx) => {
    const effects = requireValue(tx.effects, "Effects store port");
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const currentReceipt = requireValue(
        await effects.getReceipt(receiptId, { namespace: binding.namespace }),
        "durable receipt",
      );
      const currentScope = requireValue(
        await effects.reconstructScope(scope.ref, {
          namespace: binding.namespace,
        }),
        "durable Effect scope",
      );
      const unit = receipt.recoveryUnitId
        ? cache.getUnit(receipt.recoveryUnitId)
        : undefined;
      const currentUnit = unit
        ? currentScope.units.find((record) => record.unit.id === unit.id)
        : undefined;
      const envelope = cache.getEnvelope(receiptId);
      const currentEnvelope = currentScope.envelopes.find(
        (record) => record.receiptId === receiptId,
      );
      const expired =
        envelope !== undefined &&
        currentEnvelope === undefined &&
        currentReceipt.receipt.recovery === "expired";
      const appendOrder = cache.stackFor(scope.ref.id).findIndex(
        (entry) => entry.kind === "effect" && entry.receiptId === receiptId,
      );
      const settlement = {
        receipt: durableReceiptRecord(
          binding.namespace,
          expired ? Object.freeze({ ...receipt, recovery: "expired" }) : receipt,
          currentReceipt.executionIdempotencyKey,
          currentReceipt.revision + 1,
          appendOrder < 0 ? undefined : appendOrder + 1,
        ),
        ...(unit && currentUnit
          ? {
              unit: durableUnitRecord(
                binding.namespace,
                expired ? Object.freeze({ ...unit, status: "failed" }) : unit,
                receipt.effectVersion,
                currentUnit.revision + 1,
                appendOrder < 0 ? undefined : appendOrder + 1,
              ),
            }
          : {}),
        ...(envelope && currentEnvelope
          ? {
              envelope: durableEnvelopeRecord(
                binding.namespace,
                envelope,
                currentEnvelope.revision + 1,
              ),
            }
          : {}),
      };
      if (await effects.settleExecution(settlement)) {
        if (expired) {
          await restoreCache(effects, cache, scope.ref, binding);
        }
        return;
      }
      const latest = await effects.getReceipt(receiptId, {
        namespace: binding.namespace,
      });
      if (latest?.receipt.recovery !== "expired") break;
    }
    throw new TypeError(`Durable Effect receipt \`${receiptId}\` rejected settlement.`);
  });
}

/** Persist one recovery-unit lifecycle transition through the store guard. */
export async function persistDurableUnitTransition(
  cache: DurableLedgerCache,
  unitId: string,
): Promise<void> {
  const binding = currentDurableEffectLedgerBinding();
  if (!binding) return;
  const unit = requireValue(cache.getUnit(unitId), "recovery unit");
  const scope = requireValue(cache.getScope(unit.boundaryId), "scope");
  await binding.store.transact(async (tx) => {
    const effects = requireValue(tx.effects, "Effects store port");
    const snapshot = requireValue(
      await effects.reconstructScope(scope.ref, {
        namespace: binding.namespace,
      }),
      "durable Effect scope",
    );
    const current = requireValue(
      snapshot.units.find((record) => record.unit.id === unitId),
      "durable recovery unit",
    );
    const next = durableUnitRecord(
      binding.namespace,
      unit,
      current.effectVersion ?? 1,
      current.revision + 1,
      current.appendOrder,
    );
    if (!(await effects.transitionUnit({ next }))) {
      throw new TypeError(`Durable recovery unit \`${unitId}\` rejected its transition.`);
    }
  });
}

/** Refresh a ledger cache from durable records before delayed rollback. */
export async function restoreDurableEffectScope(
  cache: DurableLedgerCache,
  scope: EffectScopeRef,
): Promise<boolean> {
  const binding = currentDurableEffectLedgerBinding();
  if (!binding) return false;
  const snapshot = await binding.store.effects?.reconstructScope(scope, {
    namespace: binding.namespace,
  });
  if (!snapshot) return false;
  cache.restore(snapshot, binding);
  return true;
}

/** Refresh the scope that owns one receipt before operator reconciliation. */
export async function restoreDurableEffectReceiptScope(
  cache: DurableLedgerCache,
  receiptId: string,
): Promise<boolean> {
  const binding = currentDurableEffectLedgerBinding();
  if (!binding) return false;
  const record = await binding.store.effects?.getReceipt(receiptId, {
    namespace: binding.namespace,
  });
  if (!record) return false;
  const runId = record.receipt.runId ?? record.receipt.boundaryId;
  return restoreDurableEffectScope(cache, {
    kind: "effect.scope",
    id: record.receipt.boundaryId,
    runId,
  });
}

function requireValue<T>(value: T | null | undefined, name: string): T {
  if (value === null || value === undefined) {
    throw new TypeError(`${name} is unavailable.`);
  }
  return value;
}

async function restoreCache(
  effects: import("../../runtime/ports/effects").RuntimeEffectStorePort,
  cache: DurableLedgerCache,
  scope: EffectScopeRef,
  binding: DurableEffectLedgerBinding,
): Promise<void> {
  cache.restore(requireValue(
    await effects.reconstructScope(scope, { namespace: binding.namespace }),
    "durable Effect scope",
  ), binding);
}
