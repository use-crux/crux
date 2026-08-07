/** Shared durable Effects retention conformance cases. @module */

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

/** Register bounded envelope-expiry tests for one Runtime store adapter. */
export function runStoreEffectRetentionTests<TStore extends EffectsStore>(
  options: RunStoreEffectAdapterTestsOptions<TStore>,
): void {
  it("settles durably when an envelope expires while its receipt is running", async () => {
    const store = await options.createStore();
    const prepared = preparation("1");
    await store.transact((tx) => tx.effects!.prepare(prepared));
    const running = {
      ...prepared.receipt,
      receipt: { ...prepared.receipt.receipt, outcome: "running" as const },
      revision: 2,
    };
    await store.transact((tx) =>
      tx.effects!.transitionReceipt({ next: running }),
    );

    await expect(
      store.effects.prune({
        namespace: "tenant-a",
        before: new Date(0),
        now: new Date(10),
        limit: 1,
      }),
    ).resolves.toEqual({ removed: 1, truncated: false });
    const retained = await store.effects.getReceipt("receipt-1", {
      namespace: "tenant-a",
    });
    expect(retained?.receipt).toMatchObject({
      outcome: "running",
      recovery: "expired",
    });
    await expect(
      store.transact((tx) =>
        tx.effects!.settleExecution({
          receipt: {
            ...running,
            receipt: {
              ...running.receipt,
              outcome: "succeeded",
              recovery: "expired",
              recoveryUnitId: "unit-1",
              completedAt: 2,
            },
            revision: (retained?.revision ?? 0) + 1,
          },
          unit: {
            ...prepared.unit!,
            unit: { ...prepared.unit!.unit, status: "failed" },
            appendOrder: 1,
            revision: 2,
          },
        }),
      ),
    ).resolves.toMatchObject({
      receipt: {
        receipt: { outcome: "succeeded", recovery: "expired" },
      },
    });
  });

  it("expires a bounded envelope batch while retaining receipt audit records", async () => {
    const store = await options.createStore();
    for (const suffix of ["1", "2"]) {
      const prepared = preparation(suffix);
      await store.transact((tx) => tx.effects!.prepare(prepared));
      const running = {
        ...prepared.receipt,
        receipt: { ...prepared.receipt.receipt, outcome: "running" as const },
        revision: 2,
      };
      await store.transact((tx) =>
        tx.effects!.transitionReceipt({ next: running }),
      );
      await store.transact((tx) =>
        tx.effects!.settleExecution({
          receipt: {
            ...running,
            receipt: {
              ...running.receipt,
              outcome: "succeeded",
              recovery: "available",
              recoveryUnitId: `unit-${suffix}`,
              completedAt: 2,
            },
            revision: 3,
          },
          unit: {
            ...prepared.unit!,
            unit: { ...prepared.unit!.unit, status: "active" },
            appendOrder: Number(suffix),
            revision: 2,
          },
          envelope: {
            ...prepared.envelope!,
            revision: 2,
          },
        }),
      );
    }

    await expect(
      store.effects.prune({
        namespace: "tenant-a",
        before: new Date(0),
        now: new Date(10),
        limit: 1,
      }),
    ).resolves.toEqual({ removed: 1, truncated: true });
    await expect(
      store.effects.getReceipt("receipt-1", { namespace: "tenant-a" }),
    ).resolves.toMatchObject({
      receipt: { outcome: "succeeded", recovery: "expired" },
    });
    await expect(
      store.effects.getReceipt("receipt-2", { namespace: "tenant-a" }),
    ).resolves.toMatchObject({
      receipt: { outcome: "succeeded", recovery: "available" },
    });

    await expect(
      store.effects.prune({
        namespace: "tenant-a",
        before: new Date(0),
        now: new Date(10),
        limit: 1,
      }),
    ).resolves.toEqual({ removed: 1, truncated: false });
    await expect(
      store.effects.getReceipt("receipt-2", { namespace: "tenant-a" }),
    ).resolves.toMatchObject({
      receipt: { outcome: "succeeded", recovery: "expired" },
    });

    const snapshot = await store.effects.reconstructScope(
      preparation("2").scope.scope.ref,
      { namespace: "tenant-a" },
    );
    expect(snapshot?.receipts).toHaveLength(2);
    expect(snapshot?.envelopes).toEqual([]);
  });
}

function preparation(suffix: string): DurableEffectPreparation {
  const scope = Object.freeze({
    kind: "effect.scope" as const,
    id: "scope-retention",
    runId: "run-retention",
  });
  return {
    scope: {
      namespace: "tenant-a",
      scope: {
        ref: scope,
        status: "open",
        unitIds: ["unit-1", "unit-2"],
      },
      revision: 1,
    },
    receipt: {
      namespace: "tenant-a",
      receipt: {
        kind: "effect.receipt",
        schemaVersion: 1,
        id: `receipt-${suffix}`,
        effectId: "customer.update",
        effectVersion: 1,
        effectKind: "custom",
        scopeId: scope.id,
        boundaryId: scope.id,
        runId: scope.runId,
        attemptCount: 1,
        outcome: "preparing",
        recovery: "unavailable",
        startedAt: 1,
      },
      executionIdempotencyKey: `effect-execution:${suffix}`,
      revision: 1,
    },
    unit: {
      namespace: "tenant-a",
      kind: "effect",
      unit: {
        id: `unit-${suffix}`,
        boundaryId: scope.id,
        receiptIds: [`receipt-${suffix}`],
        effectIds: ["customer.update"],
        status: "prepared",
        idempotencyKey: `effect-recovery:${suffix}`,
      },
      effectVersion: 1,
      revision: 1,
    },
    envelope: {
      namespace: "tenant-a",
      receiptId: `receipt-${suffix}`,
      durable: true,
      envelope: {
        schemaVersion: 1,
        receiptId: `receipt-${suffix}`,
        effectId: "customer.update",
        effectVersion: 1,
        input: { revision: 1 },
        createdAt: Number(suffix),
        expiresAt: 10,
      },
      revision: 1,
    },
  };
}
