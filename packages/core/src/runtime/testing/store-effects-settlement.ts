/** Durable Effects settlement atomicity conformance. @module */

import { expect, it } from "vitest";
import type {
  DurableEffectPreparation,
  DurableEffectRecoveryClaim,
  RuntimeEffectStorePort,
} from "../ports/effects";
import type { RuntimeStoreAdapter } from "../store";
import type { RunStoreEffectAdapterTestsOptions } from "./store-types";

type EffectsStore = RuntimeStoreAdapter & {
  readonly effects: RuntimeEffectStorePort;
};

/** Register all-or-nothing execution settlement checks. */
export function runStoreEffectSettlementTests<TStore extends EffectsStore>(
  options: RunStoreEffectAdapterTestsOptions<TStore>,
  preparation: () => DurableEffectPreparation,
): void {
  it("rejects a stale envelope without partially settling execution", async () => {
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

    const unit = requireValue(prepared.unit);
    const envelope = requireValue(prepared.envelope);
    await expect(store.transact((tx) =>
      requireEffects(tx.effects).settleExecution({
        receipt: {
          ...running,
          receipt: {
            ...running.receipt,
            outcome: "succeeded" as const,
            recovery: "available" as const,
            recoveryUnitId: unit.unit.id,
            completedAt: 2,
          },
          appendOrder: 1,
          revision: 3,
        },
        unit: {
          ...unit,
          unit: { ...unit.unit, status: "active" as const },
          appendOrder: 1,
          revision: 2,
        },
        envelope: { ...envelope, revision: 3 },
      }),
    )).resolves.toBeNull();

    await expect(store.effects.reconstructScope(prepared.scope.scope.ref, {
      namespace: "tenant-a",
    })).resolves.toMatchObject({
      receipts: [{ receipt: { outcome: "unknown" }, revision: 2 }],
      units: [{ unit: { status: "prepared" }, revision: 1 }],
      envelopes: [{ revision: 1 }],
    });
  });

  it("atomically settles a claimed missing recovery target", async () => {
    const store = await options.createStore();
    const prepared = preparation();
    const claim = await claimPendingRecovery(store, prepared);
    const currentReceipt = requireValue(claim.snapshot.receipts[0]);
    const currentUnit = requireValue(claim.snapshot.units[0]);

    await expect(store.transact((tx) =>
      requireEffects(tx.effects).settleRecoveryUnavailable({
        receipt: {
          ...currentReceipt,
          receipt: {
            ...currentReceipt.receipt,
            recovery: "handler_unavailable",
          },
          revision: currentReceipt.revision + 1,
        },
        unit: {
          ...currentUnit,
          unit: { ...currentUnit.unit, status: "failed" },
          revision: currentUnit.revision + 1,
        },
      }),
    )).resolves.toMatchObject({
      receipt: { receipt: { recovery: "handler_unavailable" } },
      unit: { unit: { status: "failed" } },
    });
  });

  it("atomically persists a known failed recovery attempt", async () => {
    const store = await options.createStore();
    const prepared = preparation();
    const claim = await claimPendingRecovery(store, prepared);
    const original = requireValue(claim.snapshot.receipts[0]);
    const active = requireValue(claim.snapshot.units[0]);
    const attempt = {
      ...original,
      receipt: {
        ...original.receipt,
        id: "attempt-1",
        parentReceiptId: original.receipt.id,
        outcome: "running" as const,
        recovery: "unavailable" as const,
        startedAt: 3,
        completedAt: undefined,
      },
      appendOrder: undefined,
      executionIdempotencyKey: active.unit.idempotencyKey,
      revision: 1,
    };
    const recovering = {
      ...active,
      unit: { ...active.unit, status: "recovering" as const },
      revision: active.revision + 1,
    };
    await expect(store.transact((tx) => requireEffects(tx.effects).prepareRecovery({
      attempt: {
        namespace: "tenant-a",
        attemptReceiptId: "attempt-1",
        originalReceiptId: original.receipt.id,
        unitId: active.unit.id,
        revision: 1,
        fenceToken: claim.leaseToken,
      },
      receipt: attempt,
      unit: recovering,
    }))).resolves.toMatchObject({ unit: { unit: { status: "recovering" } } });

    await expect(store.transact((tx) =>
      requireEffects(tx.effects).settleRecoveryFailure({
        attemptReceipt: {
          ...attempt,
          receipt: {
            ...attempt.receipt,
            outcome: "failed",
            completedAt: 4,
          },
          revision: 2,
        },
        unit: {
          ...recovering,
          unit: { ...recovering.unit, status: "failed" },
          revision: recovering.revision + 1,
        },
      }),
    )).resolves.toMatchObject({
      attemptReceipt: { receipt: { outcome: "failed" } },
      unit: { unit: { status: "failed" } },
    });
    await expect(store.effects.reconstructScope(prepared.scope.scope.ref, {
      namespace: "tenant-a",
    })).resolves.toMatchObject({
      units: [{ unit: { status: "failed" } }],
      reconciliationRequired: [],
    });
  });
}

async function claimPendingRecovery(
  store: EffectsStore,
  prepared: DurableEffectPreparation,
): Promise<DurableEffectRecoveryClaim> {
  const running = {
    ...prepared.receipt,
    receipt: { ...prepared.receipt.receipt, outcome: "running" as const },
    revision: 2,
  };
  const unit = requireValue(prepared.unit);
  const envelope = requireValue(prepared.envelope);
  await store.transact((tx) => requireEffects(tx.effects).prepare(prepared));
  await store.transact((tx) =>
    requireEffects(tx.effects).transitionReceipt({ next: running }),
  );
  await store.transact((tx) => requireEffects(tx.effects).settleExecution({
    receipt: {
      ...running,
      receipt: {
        ...running.receipt,
        outcome: "succeeded",
        recovery: "available",
        recoveryUnitId: unit.unit.id,
        completedAt: 2,
      },
      appendOrder: 1,
      revision: 3,
    },
    unit: {
      ...unit,
      unit: { ...unit.unit, status: "active" },
      appendOrder: 1,
      revision: 2,
    },
    envelope: { ...envelope, revision: 2 },
  }));
  await store.transact((tx) => requireEffects(tx.effects).transitionScope({
    next: {
      ...prepared.scope,
      scope: { ...prepared.scope.scope, status: "rolling_back" },
      revision: 2,
    },
  }));
  const [claim] = await store.transact((tx) =>
    requireEffects(tx.effects).claimRecoveryScopes({
      namespace: "tenant-a",
      now: new Date(100),
      limit: 1,
      leaseMs: 50,
      leaseToken: "effect-lease-a",
    }),
  );
  return requireValue(claim);
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
