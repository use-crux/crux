import { describe, expect, it } from "vitest";
import { createWorkHost, flow, getWork, spawn } from "@use-crux/core";
import {
  createRuntimeProgram,
  createRuntimeWorker,
  inMemoryRuntimeStore,
  node,
  type WorkId,
  wakeEnvelopeForWork,
} from "@use-crux/core/runtime";

describe("durable application Work statistics", () => {
  it("restores the existing owner-scoped ledger projection after reconstruction", async () => {
    const review = flow("review-statistics", async () => "reviewed");
    const store = inMemoryRuntimeStore();
    const program = createRuntimeProgram({ targets: [review], transports: [] });
    const firstHost = createWorkHost({
      runtime: node({
        store,
        namespace: "work-statistics-test",
        autoStartMaintenance: false,
      }),
      program,
    });
    const accepted = await firstHost.run(() =>
      spawn(review, { idempotencyKey: "request_1" }),
    );
    await accepted.progress({ current: 1, total: 2 });
    await accepted.cancel({ reason: "Stopped" });

    const beforeRestart = await accepted.stats();
    expect(beforeRestart.lifecycle.cancellations).toBe(1);
    expect(beforeRestart.timing.startedAt).toBeInstanceOf(Date);
    expect(beforeRestart.timing.completedAt).toBeInstanceOf(Date);
    expect(beforeRestart.timing.activeTimeMs).toBeGreaterThanOrEqual(0);
    expect(beforeRestart.work.total).toMatchObject({
      started: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      detached: 0,
    });
    firstHost.dispose();

    const reconstructedHost = createWorkHost({
      runtime: node({
        store,
        namespace: "work-statistics-test",
        autoStartMaintenance: false,
      }),
      program,
    });
    const reconnected = await reconstructedHost.run(() =>
      getWork(review, accepted.id),
    );
    await expect(reconnected.stats()).resolves.toEqual(beforeRestart);
    reconstructedHost.dispose();
  });

  it("mechanically records suspension, resumption, and completion", async () => {
    const review = flow("review-statistics-lifecycle", async (scope) => {
      await scope.suspend("approval");
      return "done";
    });
    const store = inMemoryRuntimeStore();
    const runtime = node({
      store,
      namespace: "work-statistics-lifecycle-test",
      autoStartMaintenance: false,
    });
    const program = createRuntimeProgram({ targets: [review], transports: [] });
    const host = createWorkHost({ runtime, program });
    const accepted = await host.run(() =>
      spawn(review, { idempotencyKey: "request_1" }),
    );
    const worker = createRuntimeWorker({ runtime, program });

    try {
      await expect
        .poll(async () => (await accepted.status()).state)
        .toBe("suspended");
      const suspended = await store.state.getWork(accepted.id as WorkId, {
        namespace: "work-statistics-lifecycle-test",
      });
      if (!suspended) throw new Error("Expected suspended Work.");
      const [waiter] = await store.waiters.listByWork(suspended.workId);
      if (!waiter) throw new Error("Expected owned waiter.");
      await worker.runtime.kernel.emitEvent({
        namespace: "work-statistics-lifecycle-test",
        name: waiter.eventName,
        payload: {},
      });
      const pending = await store.state.getWork(suspended.workId, {
        namespace: "work-statistics-lifecycle-test",
      });
      if (!pending) throw new Error("Expected resumed Work.");
      await worker.runtime.kernel.handleWake(wakeEnvelopeForWork(pending));
      await expect(accepted.result()).resolves.toBe("done");

      await expect(accepted.stats()).resolves.toMatchObject({
        lifecycle: { suspensions: 1, resumptions: 1 },
        timing: { completedAt: expect.any(Date) },
      });
    } finally {
      await worker.stop();
      host.dispose();
    }
  });
});
