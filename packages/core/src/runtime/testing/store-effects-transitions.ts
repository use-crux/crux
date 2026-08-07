/** Durable Effects lifecycle transition conformance. @module */

import { expect, it } from "vitest";
import type {
  DurableEffectPreparation,
  RuntimeEffectStorePort,
} from "../ports/effects";
import type { RuntimeStoreAdapter } from "../store";
import type { RunStoreEffectAdapterTestsOptions } from "./store-types";

type EffectsStore = RuntimeStoreAdapter & {
  readonly effects: RuntimeEffectStorePort;
};

/** Register guarded scope and recovery-unit lifecycle checks. */
export function runStoreEffectTransitionTests<TStore extends EffectsStore>(
  options: RunStoreEffectAdapterTestsOptions<TStore>,
  preparation: () => DurableEffectPreparation,
): void {
  it("guards scope and recovery-unit lifecycle transitions", async () => {
    const store = await options.createStore();
    const prepared = preparation();
    await store.transact((tx) => requireEffects(tx.effects).prepare(prepared));

    const closedScope = {
      ...prepared.scope,
      scope: { ...prepared.scope.scope, status: "closed" as const },
      revision: 2,
    };
    await expect(store.transact((tx) =>
      requireEffects(tx.effects).transitionScope({ next: closedScope }),
    )).resolves.toMatchObject({ scope: { status: "closed" } });
    await expect(store.effects.transitionScope({ next: closedScope }))
      .resolves.toBeNull();

    const unit = requireValue(prepared.unit);
    const activeUnit = {
      ...unit,
      unit: { ...unit.unit, status: "active" as const },
      revision: 2,
    };
    await expect(store.transact((tx) =>
      requireEffects(tx.effects).transitionUnit({ next: activeUnit }),
    )).resolves.toMatchObject({ unit: { status: "active" } });
    await expect(store.effects.transitionUnit({ next: activeUnit }))
      .resolves.toBeNull();
  });

  it("atomically registers nested boundary units with their parent scope", async () => {
    const store = await options.createStore();
    const parent = Object.freeze({
      kind: "effect.scope" as const,
      id: "scope-sync-parent",
      runId: "run-sync",
    });
    const child = Object.freeze({
      kind: "effect.scope" as const,
      id: "scope-sync-child",
      runId: "run-sync",
    });
    const unit = {
      namespace: "tenant-a",
      kind: "boundary" as const,
      scope: child,
      unit: {
        id: "effect-boundary-unit:scope-sync-child",
        boundaryId: parent.id,
        receiptIds: ["receipt-sync-child"],
        effectIds: ["customer.sync-child"],
        status: "recovered" as const,
        idempotencyKey: "effect-boundary-recovery:scope-sync-child",
      },
      appendOrder: 1,
      revision: 1,
    };
    const synchronization = {
      scope: {
        namespace: "tenant-a",
        scope: {
          ref: parent,
          status: "closed" as const,
          unitIds: [unit.unit.id],
        },
        revision: 1,
      },
      units: [unit],
    };

    await expect(store.transact((tx) =>
      requireEffects(tx.effects).synchronizeScope(synchronization),
    )).resolves.toMatchObject({ units: [{ kind: "boundary" }] });
    await expect(store.effects.synchronizeScope(synchronization))
      .resolves.toBeNull();
    await expect(store.effects.reconstructScope(parent, {
      namespace: "tenant-a",
    })).resolves.toMatchObject({
      plan: [{ kind: "boundary", status: "already_recovered" }],
    });
  });

  it("atomically prepares and settles recovery attempts", async () => {
    const store = await options.createStore();
    const prepared = preparation();
    const original = await settlePreparedEffect(store, prepared);
    const activeUnit = {
      ...requireValue(prepared.unit),
      unit: {
        ...requireValue(prepared.unit).unit,
        status: "active" as const,
      },
      appendOrder: 1,
      revision: 2,
    };
    const attemptReceipt = {
      namespace: "tenant-a",
      receipt: {
        ...original.receipt,
        id: "receipt-recovery-1",
        parentReceiptId: original.receipt.id,
        outcome: "running" as const,
        recovery: "unavailable" as const,
        startedAt: 3,
        completedAt: undefined,
      },
      executionIdempotencyKey: activeUnit.unit.idempotencyKey,
      revision: 1,
    };
    const recovery = {
      attempt: {
        namespace: "tenant-a",
        attemptReceiptId: attemptReceipt.receipt.id,
        originalReceiptId: original.receipt.id,
        unitId: activeUnit.unit.id,
        revision: 1,
      },
      receipt: attemptReceipt,
      unit: {
        ...activeUnit,
        unit: { ...activeUnit.unit, status: "recovering" as const },
        revision: 3,
      },
    };
    await expect(store.transact((tx) =>
      requireEffects(tx.effects).prepareRecovery(recovery),
    )).resolves.toMatchObject({ unit: { unit: { status: "recovering" } } });

    const settlement = {
      attemptReceipt: {
        ...attemptReceipt,
        receipt: {
          ...attemptReceipt.receipt,
          outcome: "succeeded" as const,
          completedAt: 4,
        },
        revision: 2,
      },
      originalReceipt: {
        ...original,
        receipt: { ...original.receipt, recovery: "recovered" as const },
        revision: 4,
      },
      unit: {
        ...recovery.unit,
        unit: { ...recovery.unit.unit, status: "recovered" as const },
        revision: 4,
      },
    };
    await expect(store.transact((tx) =>
      requireEffects(tx.effects).settleRecovery(settlement),
    )).resolves.toMatchObject({ unit: { unit: { status: "recovered" } } });
    await expect(store.effects.reconstructScope(prepared.scope.scope.ref, {
      namespace: "tenant-a",
    })).resolves.toMatchObject({
      attempts: [{ attemptReceiptId: "receipt-recovery-1" }],
      plan: [{ status: "already_recovered" }],
    });
  });

  it("atomically reconciles ambiguous execution records with an audit", async () => {
    const store = await options.createStore();
    const prepared = preparation();
    await store.transact((tx) => requireEffects(tx.effects).prepare(prepared));
    const running = {
      ...prepared.receipt,
      receipt: { ...prepared.receipt.receipt, outcome: "running" as const },
      revision: 2,
    };
    await store.transact((tx) =>
      requireEffects(tx.effects).transitionReceipt({ next: running }),
    );
    const unknown = {
      ...running,
      receipt: {
        ...running.receipt,
        outcome: "unknown" as const,
        recovery: "ambiguous" as const,
      },
      revision: 3,
    };
    await store.transact((tx) =>
      requireEffects(tx.effects).transitionReceipt({ next: unknown }),
    );
    const unit = requireValue(prepared.unit);
    const envelope = requireValue(prepared.envelope);
    const settlement = {
      reconciliation: {
        namespace: "tenant-a",
        receiptId: unknown.receipt.id,
        outcome: "succeeded" as const,
        reason: "operator verified the external state",
        reconciledAt: 4,
        revision: 1,
      },
      receipts: [{
        ...unknown,
        receipt: {
          ...unknown.receipt,
          outcome: "succeeded" as const,
          recovery: "available" as const,
          recoveryUnitId: unit.unit.id,
          completedAt: 4,
        },
        appendOrder: 1,
        revision: 4,
      }],
      unit: {
        ...unit,
        unit: { ...unit.unit, status: "active" as const },
        appendOrder: 1,
        revision: 2,
      },
      envelope: { ...envelope, revision: 2 },
    };

    await expect(store.transact((tx) =>
      requireEffects(tx.effects).reconcile(settlement),
    )).resolves.toMatchObject({ reconciliation: { revision: 1 } });
    await expect(store.effects.reconcile(settlement)).resolves.toBeNull();
    await expect(store.effects.reconstructScope(prepared.scope.scope.ref, {
      namespace: "tenant-a",
    })).resolves.toMatchObject({
      reconciliations: [{ reason: "operator verified the external state" }],
      plan: [{ receiptId: "receipt-1", status: "active" }],
      reconciliationRequired: [],
    });
  });
}

async function settlePreparedEffect(
  store: EffectsStore,
  prepared: DurableEffectPreparation,
) {
  await store.transact((tx) => requireEffects(tx.effects).prepare(prepared));
  const running = {
    ...prepared.receipt,
    receipt: { ...prepared.receipt.receipt, outcome: "running" as const },
    revision: 2,
  };
  await store.transact((tx) =>
    requireEffects(tx.effects).transitionReceipt({ next: running }),
  );
  const original = {
    ...running,
    receipt: {
      ...running.receipt,
      outcome: "succeeded" as const,
      recovery: "available" as const,
      recoveryUnitId: "unit-1",
      completedAt: 2,
    },
    appendOrder: 1,
    revision: 3,
  };
  const unit = requireValue(prepared.unit);
  await store.transact((tx) => requireEffects(tx.effects).settleExecution({
    receipt: original,
    unit: {
      ...unit,
      unit: { ...unit.unit, status: "active" as const },
      appendOrder: 1,
      revision: 2,
    },
  }));
  return original;
}

function requireEffects(
  port: RuntimeEffectStorePort | undefined,
): RuntimeEffectStorePort {
  return requireValue(port);
}

function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw new TypeError("Effects value is missing.");
  return value;
}
