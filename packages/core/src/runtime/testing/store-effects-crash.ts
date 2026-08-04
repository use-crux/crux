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
