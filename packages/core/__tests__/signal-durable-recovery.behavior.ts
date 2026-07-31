import { expect, it } from "vitest";
import { config, flow, signal } from "@use-crux/core";
import {
  createRuntime,
  node,
  runtimeTargetMap,
  type FlowId,
  type RuntimeTargetRuntimeRef,
  type WorkId,
} from "@use-crux/core/runtime";
import { z } from "zod";
import {
  deferred,
  durableMemoryRuntimeStore,
  expectFlowStatus,
  expectOutboxState,
} from "./signal-durable-test-helpers";

/** Register restart and independent-delivery behaviors in the acceptance suite. */
export function registerSignalDurableRecoveryBehaviors(): void {
  it("recovers a pending delivery after Runtime restart", async () => {
    const store = durableMemoryRuntimeStore();
    let now = new Date("2026-07-31T20:00:00.000Z");
    const firstDelivery = deferred();
    const failingRuntime = Object.freeze({
      ...node({
        store,
        namespace: "signal-restart-test",
        autoStartMaintenance: false,
      }),
      now: () => now,
      createWake: () => async () => {
        firstDelivery.resolve();
        throw new Error("simulated process loss before delivery");
      },
    });
    const crux = config({ runtime: failingRuntime });
    const checksChanged = signal({
      id: "ci.checks.restart",
      schema: z.object({ sha: z.string() }),
    });
    const resumed = deferred();
    const release = flow(
      "restart release",
      { signals: { checksChanged } },
      async (scope) => {
        await scope.waitFor(checksChanged);
        resumed.resolve();
      },
    );

    try {
      await release.run({ flowId: "flow_signal_restart" });
      const receipt = await checksChanged.publish({ sha: "restart-sha" });
      await firstDelivery.promise;
      await expectOutboxState(store, "signal-restart-test", "pending");
      crux.dispose();

      now = new Date(now.getTime() + 10_000);
      const runtimeRef: RuntimeTargetRuntimeRef = {};
      const restarted = createRuntime({
        runtime: Object.freeze({
          ...node({
            store,
            namespace: "signal-restart-test",
            autoStartMaintenance: false,
          }),
          now: () => now,
        }),
        targets: runtimeTargetMap(runtimeRef),
        startMaintenance: false,
      });
      runtimeRef.current = restarted;
      try {
        await restarted.dispatcher.nudge();
        await resumed.promise;
        await expectFlowStatus(
          store,
          "signal-restart-test",
          "flow_signal_restart",
          "completed",
        );
        await expect(
          store.signals.listDeliveries(
            "signal-restart-test",
            receipt.occurrenceId,
          ),
        ).resolves.toMatchObject([{ state: "delivered", attempts: 1 }]);
      } finally {
        restarted.dispose();
      }
    } finally {
      crux.dispose();
    }
  });

  it("isolates one failing consumer from another required delivery", async () => {
    const store = durableMemoryRuntimeStore();
    let now = new Date("2026-07-31T21:00:00.000Z");
    const runtimeDefinition = Object.freeze({
      ...node({
        store,
        namespace: "signal-isolation-test",
        autoStartMaintenance: false,
      }),
      now: () => now,
    });
    const crux = config({ runtime: runtimeDefinition });
    const changed = signal({
      id: "ci.checks.isolation",
      schema: z.object({ sha: z.string() }),
    });
    const failed = deferred();
    const completed = deferred();
    const occurrenceIds: string[] = [];
    let failingExecutions = 0;
    let failingCalls = 0;
    let successfulCalls = 0;
    const failingRelease = flow(
      "failing release",
      { signals: { changed } },
      async (scope) => {
        failingExecutions += 1;
        const occurrence = await scope.waitFor(changed);
        occurrenceIds.push(occurrence.id);
        failingCalls += 1;
        if (failingCalls === 1) {
          failed.resolve();
          throw new Error("one consumer failed");
        }
      },
    );
    const successfulRelease = flow(
      "successful release",
      { signals: { changed } },
      async (scope) => {
        const occurrence = await scope.waitFor(changed);
        occurrenceIds.push(occurrence.id);
        successfulCalls += 1;
        completed.resolve();
      },
    );

    try {
      await failingRelease.run({ flowId: "flow_signal_failing" });
      await successfulRelease.run({ flowId: "flow_signal_successful" });
      const receipt = await changed.publish({ sha: "isolation-sha" });
      await Promise.all([failed.promise, completed.promise]);
      await expectFlowStatus(
        store,
        "signal-isolation-test",
        "flow_signal_successful",
        "completed",
      );
      const deliveriesAfterFailure = await expectDeliveryAttempts(
        store,
        "signal-isolation-test",
        receipt.occurrenceId,
        [1, 1],
      );
      const deliveryIds = deliveriesAfterFailure.map(
        ({ deliveryId }) => deliveryId,
      );
      expect(new Set(deliveryIds).size).toBe(2);
      expect(
        deliveriesAfterFailure
          .map(({ state, attempts }) => ({ state, attempts }))
          .sort((left, right) => left.state.localeCompare(right.state)),
      ).toEqual([
        { state: "delivered", attempts: 1 },
        { state: "pending", attempts: 1 },
      ]);
      const failingSnapshot = await store.state.getSnapshot(
        "flow_signal_failing" as FlowId,
        { namespace: "signal-isolation-test" },
      );
      expect(failingSnapshot).not.toBeNull();
      await expectWorkLeaseAvailable(store, failingSnapshot!.workId);
      const retryWork = await store.state.getWork(failingSnapshot!.workId, {
        namespace: "signal-isolation-test",
      });
      const retryOutbox = await store.outbox.listByWork(
        failingSnapshot!.workId,
        { namespace: "signal-isolation-test", limit: 10 },
      );
      expect(retryWork).toMatchObject({ status: "pending", attempt: 2 });
      expect(retryOutbox.map(({ envelope }) => envelope.attempt)).toEqual([
        1, 2,
      ]);

      now = new Date(now.getTime() + 10_000);
      const runtimeRef: RuntimeTargetRuntimeRef = {};
      const restarted = createRuntime({
        runtime: runtimeDefinition,
        targets: runtimeTargetMap(runtimeRef),
        startMaintenance: false,
      });
      runtimeRef.current = restarted;
      try {
        const dispatch = await restarted.dispatcher.dispatchBatch({
          concurrency: 1,
        });
        expect(dispatch.delivered).toBeGreaterThanOrEqual(1);
        expect(dispatch.failed).toBe(0);
        await expectFlowStatus(
          store,
          "signal-isolation-test",
          "flow_signal_failing",
          "completed",
        );
      } finally {
        restarted.dispose();
      }

      const finalDeliveries = await expectDeliveryAttempts(
        store,
        "signal-isolation-test",
        receipt.occurrenceId,
        [1, 2],
      );
      expect(finalDeliveries.map(({ deliveryId }) => deliveryId)).toEqual(
        deliveryIds,
      );
      expect(finalDeliveries.map(({ state }) => state)).toEqual([
        "delivered",
        "delivered",
      ]);
      expect(
        finalDeliveries
          .map(({ attempts }) => attempts)
          .sort((left, right) => left - right),
      ).toEqual([1, 2]);
      expect(occurrenceIds).toHaveLength(3);
      expect(occurrenceIds.every((id) => id === receipt.occurrenceId)).toBe(
        true,
      );
      expect(failingCalls).toBe(2);
      expect(failingExecutions).toBe(3);
      expect(successfulCalls).toBe(1);
    } finally {
      crux.dispose();
    }
  });
}

async function expectDeliveryAttempts(
  store: ReturnType<typeof durableMemoryRuntimeStore>,
  namespace: string,
  occurrenceId: string,
  attempts: readonly number[],
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const deliveries = await store.signals.listDeliveries(
      namespace,
      occurrenceId,
    );
    if (
      deliveries.length === attempts.length &&
      deliveries
        .map((delivery) => delivery.attempts)
        .sort((left, right) => left - right)
        .every((value, index) => value === attempts[index])
    ) {
      return deliveries;
    }
    await Promise.resolve();
  }
  return await store.signals.listDeliveries(namespace, occurrenceId);
}

async function expectWorkLeaseAvailable(
  store: ReturnType<typeof durableMemoryRuntimeStore>,
  workId: WorkId,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const lease = await store.leases.claim(`work:${workId}`, { ttlMs: 1_000 });
    if (lease) {
      await store.leases.release(lease);
      return;
    }
    await Promise.resolve();
  }
  const lease = await store.leases.claim(`work:${workId}`, { ttlMs: 1_000 });
  expect(lease).not.toBeNull();
  if (lease) await store.leases.release(lease);
}
