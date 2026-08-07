/** Durable Effects crash-window and concurrency conformance. @module */

import { expect, it } from "vitest";
import type {
  DurableEffectPreparation,
  RuntimeEffectStorePort,
} from "../ports/effects";
import type { RuntimeStoreAdapter } from "../store";
import type { RunStoreAdapterTestsOptions } from "./store-types";

type EffectsStore = RuntimeStoreAdapter & {
  readonly effects: RuntimeEffectStorePort;
};

/** Register crash-state, terminal-race, and stale-fence cases. */
export function runStoreEffectCrashTests<TStore extends EffectsStore>(
  options: RunStoreAdapterTestsOptions<TStore>,
  preparation: () => DurableEffectPreparation,
): void {
  it("reclaims expired recovery work and fences the superseded holder", async () => {
    const store = await options.createStore();
    const prepared = preparation();
    await makeRecoveryPending(store, prepared);

    const first = await store.transact((tx) => requireEffects(tx.effects).claimRecoveryScopes({
      namespace: "tenant-a",
      now: new Date(100),
      limit: 1,
      leaseMs: 50,
      leaseToken: "effect-lease-a",
      ownerId: "worker-a",
    }));
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      scope: prepared.scope.scope.ref,
      leaseToken: "effect-lease-a",
      ownerId: "worker-a",
    });

    await expect(store.transact((tx) => requireEffects(tx.effects).claimRecoveryScopes({
      namespace: "tenant-a",
      now: new Date(149),
      limit: 1,
      leaseMs: 50,
      leaseToken: "effect-lease-b",
    }))).resolves.toEqual([]);

    const reclaimed = await store.transact((tx) => requireEffects(tx.effects).claimRecoveryScopes({
      namespace: "tenant-a",
      now: new Date(150),
      limit: 1,
      leaseMs: 50,
      leaseToken: "effect-lease-b",
      ownerId: "worker-b",
    }));
    expect(reclaimed).toHaveLength(1);
    expect(reclaimed[0]).toMatchObject({
      leaseToken: "effect-lease-b",
      ownerId: "worker-b",
    });

    const staleUnit = first[0]!.snapshot.units[0]!;
    await expect(store.effects.transitionUnit({
      next: {
        ...staleUnit,
        unit: { ...staleUnit.unit, status: "recovering" },
        revision: staleUnit.revision + 1,
      },
    })).resolves.toBeNull();
  });

  it("does not discover a rolling-back scope whose plan is fully recovered", async () => {
    const store = await options.createStore();
    const prepared = preparation();
    await makeRecoveryPending(store, prepared);
    const [claim] = await store.transact((tx) => requireEffects(tx.effects).claimRecoveryScopes({
      namespace: "tenant-a",
      now: new Date(100),
      limit: 1,
      leaseMs: 50,
      leaseToken: "effect-lease-a",
    }));
    const active = claim!.snapshot.units[0]!;
    const recovering = {
      ...active,
      unit: { ...active.unit, status: "recovering" as const },
      revision: active.revision + 1,
    };
    await expect(store.effects.transitionUnit({ next: recovering }))
      .resolves.toMatchObject({ unit: { status: "recovering" } });
    await expect(store.effects.transitionUnit({
      next: {
        ...recovering,
        unit: { ...recovering.unit, status: "recovered" },
        revision: recovering.revision + 1,
      },
    })).resolves.toMatchObject({ unit: { status: "recovered" } });

    await expect(store.transact((tx) => requireEffects(tx.effects).claimRecoveryScopes({
      namespace: "tenant-a",
      now: new Date(150),
      limit: 1,
      leaseMs: 50,
      leaseToken: "effect-lease-b",
    }))).resolves.toEqual([]);
  });

  it("releases an idle claim without removing its write fence", async () => {
    const store = await options.createStore();
    const prepared = preparation();
    await makeRecoveryPending(store, prepared);
    const [claim] = await store.transact((tx) => requireEffects(tx.effects).claimRecoveryScopes({
      namespace: "tenant-a",
      now: new Date(100),
      limit: 1,
      leaseMs: 50,
      leaseToken: "effect-lease-a",
    }));
    await expect(store.transact((tx) => requireEffects(tx.effects).releaseRecoveryScope({
      namespace: "tenant-a",
      scope: prepared.scope.scope.ref,
      leaseToken: "effect-lease-a",
      now: new Date(101),
    }))).resolves.toBe(true);
    await expect(store.transact((tx) => requireEffects(tx.effects).claimRecoveryScopes({
      namespace: "tenant-a",
      now: new Date(101),
      limit: 1,
      leaseMs: 50,
      leaseToken: "effect-lease-b",
    }))).resolves.toHaveLength(1);

    const staleUnit = claim!.snapshot.units[0]!;
    await expect(store.effects.transitionUnit({
      next: {
        ...staleUnit,
        unit: { ...staleUnit.unit, status: "recovering" },
        revision: staleUnit.revision + 1,
      },
    })).resolves.toBeNull();
  });

  it("rejects writes from a stale persisted fence", async () => {
    const store = await options.createStore();
    const prepared = preparation();
    const fenced = {
      ...prepared,
      receipt: { ...prepared.receipt, fenceToken: "lease-current" },
    };
    await store.transact((tx) => requireEffects(tx.effects).prepare(fenced));

    const running = {
      ...fenced.receipt,
      receipt: { ...fenced.receipt.receipt, outcome: "running" as const },
      revision: 2,
    };
    await expect(store.effects.transitionReceipt({
      next: { ...running, fenceToken: "lease-stale" },
    })).resolves.toBeNull();
    await expect(
      store.effects.transitionReceipt({ next: running }),
    ).resolves.toMatchObject({ fenceToken: "lease-current" });
  });

  it("surfaces prepared executions for reconciliation without retrying", async () => {
    const store = await options.createStore();
    const prepared = preparation();
    await store.transact((tx) => requireEffects(tx.effects).prepare(prepared));

    const snapshot = await store.effects.reconstructScope(
      prepared.scope.scope.ref,
      { namespace: "tenant-a" },
    );

    expect(snapshot?.receipts[0]?.receipt.outcome).toBe("preparing");
    expect(snapshot?.plan).toEqual([]);
    expect(snapshot?.reconciliationRequired).toEqual([{
      kind: "execution",
      receiptId: "receipt-1",
      state: "prepared",
      idempotencyKey: "effect-execution:1",
    }]);
  });

  it("reconstructs an unsettled running execution as unknown", async () => {
    const store = await options.createStore();
    const prepared = preparation();
    await store.transact((tx) => requireEffects(tx.effects).prepare(prepared));
    await store.transact((tx) => requireEffects(tx.effects).transitionReceipt({
      next: runningReceipt(prepared),
    }));

    const snapshot = await store.effects.reconstructScope(
      prepared.scope.scope.ref,
      { namespace: "tenant-a" },
    );

    expect(snapshot?.receipts[0]?.receipt).toMatchObject({
      outcome: "unknown",
      recovery: "ambiguous",
      recoveryUnitId: "unit-1",
    });
    expect(snapshot?.plan).toEqual([]);
    expect(snapshot?.reconciliationRequired).toEqual([{
      kind: "execution",
      receiptId: "receipt-1",
      state: "unknown",
      idempotencyKey: "effect-execution:1",
    }]);
  });

  it("retains an explicitly unknown execution for reconciliation", async () => {
    const store = await options.createStore();
    const prepared = preparation();
    const running = runningReceipt(prepared);
    await store.transact((tx) => requireEffects(tx.effects).prepare(prepared));
    await store.transact((tx) =>
      requireEffects(tx.effects).transitionReceipt({ next: running }),
    );
    await store.transact((tx) =>
      requireEffects(tx.effects).transitionReceipt({
        next: {
          ...running,
          receipt: {
            ...running.receipt,
            outcome: "unknown",
            recovery: "ambiguous",
          },
          revision: 3,
        },
      }),
    );

    const snapshot = await store.effects.reconstructScope(
      prepared.scope.scope.ref,
      { namespace: "tenant-a" },
    );
    expect(snapshot?.reconciliationRequired).toEqual([
      expect.objectContaining({ state: "unknown", receiptId: "receipt-1" }),
    ]);
  });

  it("allows exactly one concurrent terminal transition", async () => {
    const store = await options.createStore();
    const prepared = preparation();
    const running = runningReceipt(prepared);
    await store.transact((tx) => requireEffects(tx.effects).prepare(prepared));
    await store.transact((tx) =>
      requireEffects(tx.effects).transitionReceipt({ next: running }),
    );
    const terminal = (outcome: "succeeded" | "failed") => ({
      ...running,
      receipt: { ...running.receipt, outcome, completedAt: 2 },
      revision: 3,
    });

    const results = await Promise.all([
      store.transact((tx) =>
        requireEffects(tx.effects).transitionReceipt({
          next: terminal("succeeded"),
        }),
      ),
      store.transact((tx) =>
        requireEffects(tx.effects).transitionReceipt({
          next: terminal("failed"),
        }),
      ),
    ]);

    expect(results.filter((result) => result !== null)).toHaveLength(1);
    await expect(store.effects.getReceipt("receipt-1", {
      namespace: "tenant-a",
    })).resolves.toMatchObject({
      receipt: { outcome: results.find(Boolean)?.receipt.outcome },
    });
  });
}

async function makeRecoveryPending(
  store: EffectsStore,
  prepared: DurableEffectPreparation,
): Promise<void> {
  const running = runningReceipt(prepared);
  await store.transact((tx) => requireEffects(tx.effects).prepare(prepared));
  await store.transact((tx) => requireEffects(tx.effects).transitionReceipt({
    next: running,
  }));
  await store.transact((tx) => requireEffects(tx.effects).settleExecution({
    receipt: {
      ...running,
      receipt: {
        ...running.receipt,
        outcome: "succeeded",
        recovery: "available",
        recoveryUnitId: prepared.unit!.unit.id,
        completedAt: 2,
      },
      appendOrder: 1,
      revision: 3,
    },
    unit: {
      ...prepared.unit!,
      unit: { ...prepared.unit!.unit, status: "active" },
      appendOrder: 1,
      revision: 2,
    },
    envelope: {
      ...prepared.envelope!,
      revision: 2,
    },
  }));
  await store.transact((tx) => requireEffects(tx.effects).transitionScope({
    next: {
      ...prepared.scope,
      scope: { ...prepared.scope.scope, status: "rolling_back" },
      revision: 2,
    },
  }));
}

function runningReceipt(prepared: DurableEffectPreparation) {
  return {
    ...prepared.receipt,
    receipt: { ...prepared.receipt.receipt, outcome: "running" as const },
    revision: 2,
  };
}

function requireEffects(
  port: RuntimeEffectStorePort | undefined,
): RuntimeEffectStorePort {
  if (!port) throw new TypeError("Effects store is missing.");
  return port;
}
