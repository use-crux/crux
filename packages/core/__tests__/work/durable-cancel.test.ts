import { describe, expect, it, vi } from "vitest";
import { createWorkHost, flow, spawn } from "@use-crux/core";
import {
  createRuntimeProgram,
  createRuntimeWorker,
  inMemoryRuntimeStore,
  node,
  transition,
  type WorkId,
} from "@use-crux/core/runtime";

describe("durable application Work cancellation", () => {
  it("cancels queued Work idempotently and fences late execution", async () => {
    const execute = vi.fn(async () => "late-result");
    const review = flow("review-cancelled", execute);
    const store = inMemoryRuntimeStore();
    const runtime = node({
      store,
      namespace: "work-cancel-test",
      autoStartMaintenance: false,
    });
    const program = createRuntimeProgram({ targets: [review], transports: [] });
    const host = createWorkHost({ runtime, program });
    const accepted = await host.run(() =>
      spawn(review, { idempotencyKey: "request_1" }),
    );

    await expect(
      accepted.cancel({ reason: "No longer needed" }),
    ).resolves.toMatchObject({
      workId: accepted.id,
      outcome: "cancelled",
      status: { state: "cancelled", reason: "No longer needed" },
    });
    await expect(accepted.cancel()).resolves.toMatchObject({
      workId: accepted.id,
      outcome: "already-terminal",
      status: { state: "cancelled", reason: "No longer needed" },
    });
    await expect(accepted.result()).rejects.toMatchObject({
      code: "work_cancelled",
      workId: accepted.id,
      reason: "No longer needed",
    });

    const worker = createRuntimeWorker({ runtime, program });
    try {
      await expect(accepted.status()).resolves.toMatchObject({
        state: "cancelled",
        reason: "No longer needed",
      });
      expect(execute).not.toHaveBeenCalled();
    } finally {
      await worker.stop();
      host.dispose();
    }
  });

  it("preserves a completion that wins the terminal race", async () => {
    const review = flow("review-completion-race", async () => "winner");
    const store = inMemoryRuntimeStore();
    const runtime = node({
      store,
      namespace: "work-cancel-completion-race-test",
      autoStartMaintenance: false,
    });
    const program = createRuntimeProgram({ targets: [review], transports: [] });
    const host = createWorkHost({ runtime, program });
    const accepted = await host.run(() =>
      spawn(review, { idempotencyKey: "request_1" }),
    );
    const worker = createRuntimeWorker({ runtime, program });

    try {
      await expect(accepted.result()).resolves.toBe("winner");
      await expect(
        accepted.cancel({ reason: "Too late" }),
      ).resolves.toMatchObject({
        outcome: "already-terminal",
        status: { state: "completed", resultAvailable: true },
      });
      await expect(accepted.result()).resolves.toBe("winner");
    } finally {
      await worker.stop();
      host.dispose();
    }
  });

  it("cancels suspended Work through the existing waiter and timer composite", async () => {
    const execute = vi.fn(async (scope) => {
      await scope.suspend("approval", { timeout: "1h" });
      return "late-result";
    });
    const review = flow("review-suspended-cancel", execute);
    const store = inMemoryRuntimeStore();
    const runtime = node({
      store,
      namespace: "work-cancel-suspended-test",
      autoStartMaintenance: false,
    });
    const program = createRuntimeProgram({ targets: [review], transports: [] });
    const host = createWorkHost({ runtime, program });
    const accepted = await host.run(() =>
      spawn(review, { idempotencyKey: "request_1" }),
    );
    const worker = createRuntimeWorker({ runtime, program });

    try {
      await vi.waitFor(async () => {
        expect(await accepted.status()).toMatchObject({ state: "suspended" });
      });
      const [waiter] = await store.waiters.listByWork(accepted.id as WorkId);
      const [timer] = await store.timers.listByWork(accepted.id as WorkId);
      if (!waiter || !timer)
        throw new Error("Expected owned waiter and timer.");

      await expect(accepted.cancel()).resolves.toMatchObject({
        outcome: "cancelled",
        status: { state: "cancelled" },
      });
      await expect(
        store.waiters.transition(waiter.waiterId, "armed", "fired"),
      ).resolves.toBe(false);
      await expect(
        store.timers.transition(timer.timerId, "scheduled", "fired"),
      ).resolves.toBe(false);
      expect(execute).toHaveBeenCalledOnce();
    } finally {
      await worker.stop();
      host.dispose();
    }
  });

  it("cancels recoverable blocked Work instead of treating it as terminal", async () => {
    const review = flow("review-blocked-cancel", async () => "done");
    const store = inMemoryRuntimeStore();
    const host = createWorkHost({
      runtime: node({
        store,
        namespace: "work-cancel-blocked-test",
        autoStartMaintenance: false,
      }),
      program: createRuntimeProgram({ targets: [review], transports: [] }),
    });
    const accepted = await host.run(() =>
      spawn(review, { idempotencyKey: "request_1" }),
    );
    const queued = await store.state.getWork(accepted.id as WorkId, {
      namespace: "work-cancel-blocked-test",
    });
    if (!queued) throw new Error("Expected queued Work.");
    await store.state.putWork(
      transition(queued, {
        status: "blocked",
        lastError: {
          code: "TEMPORARY_BLOCK",
          message: "Operator action required.",
          at: new Date(),
        },
      }),
    );

    await expect(accepted.cancel()).resolves.toMatchObject({
      outcome: "cancelled",
      status: { state: "cancelled" },
    });
    host.dispose();
  });
});
