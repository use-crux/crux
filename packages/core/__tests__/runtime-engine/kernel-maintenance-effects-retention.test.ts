import { describe, expect, it } from "vitest";
import { inMemoryRuntimeStore } from "../../src/runtime/adapters/memory";
import { createRuntimeKernel } from "../../src/runtime/engine/kernel";
import type { WorkId } from "../../src/runtime/ports";

describe("RuntimeKernel durable Effect retention", () => {
  it("expires recovery envelopes during bounded maintenance", async () => {
    const store = inMemoryRuntimeStore();
    const scope = Object.freeze({
      kind: "effect.scope" as const,
      id: "scope-retention",
      runId: "run-retention",
    });
    await store.effects.prepare({
      scope: {
        namespace: "tenant-a",
        scope: { ref: scope, status: "open", unitIds: [] },
        revision: 1,
      },
      receipt: {
        namespace: "tenant-a",
        receipt: {
          kind: "effect.receipt",
          schemaVersion: 1,
          id: "receipt-retention",
          effectId: "customer.update",
          effectVersion: 1,
          effectKind: "custom",
          scopeId: scope.id,
          boundaryId: scope.id,
          attemptCount: 1,
          outcome: "succeeded",
          recovery: "available",
          startedAt: 1,
          completedAt: 2,
        },
        executionIdempotencyKey: "effect-execution:retention",
        revision: 1,
      },
      envelope: {
        namespace: "tenant-a",
        receiptId: "receipt-retention",
        durable: true,
        envelope: {
          schemaVersion: 1,
          receiptId: "receipt-retention",
          effectId: "customer.update",
          effectVersion: 1,
          createdAt: 1,
          expiresAt: 10,
        },
        revision: 1,
      },
    });
    const kernel = createRuntimeKernel({
      store,
      targets: {},
      newWorkId: () => "unused" as WorkId,
      now: () => new Date(20),
      retention: { effectEnvelopes: 0, sweepLimit: 1 },
    });

    await expect(
      kernel.maintenanceTick({ namespace: "tenant-a", now: new Date(20) }),
    ).resolves.toMatchObject({
      retainedRecordsRemoved: 1,
      retentionTruncated: false,
    });
    await expect(
      store.effects.getReceipt("receipt-retention", {
        namespace: "tenant-a",
      }),
    ).resolves.toMatchObject({ receipt: { recovery: "expired" } });
    await expect(
      store.effects.reconstructScope(scope, { namespace: "tenant-a" }),
    ).resolves.toMatchObject({ envelopes: [], receipts: [expect.any(Object)] });
  });
});
