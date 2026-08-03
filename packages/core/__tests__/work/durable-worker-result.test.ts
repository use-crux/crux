import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { createWorkHost, flow, getWork, spawn } from "@use-crux/core";
import {
  createRuntimeProgram,
  createRuntimeWorker,
  inMemoryRuntimeStore,
  node,
  type WorkId,
  wakeEnvelopeForWork,
} from "@use-crux/core/runtime";

describe("durable application Work execution", () => {
  it("joins the exact generated Flow result after worker execution", async () => {
    const execute = vi.fn(
      async (_flow, input: { readonly documentId: string }) => ({
        documentId: input.documentId,
        reviewed: true as const,
      }),
    );
    const review = flow("review-worker-result", execute);
    const store = inMemoryRuntimeStore();
    const runtime = node({
      store,
      namespace: "worker-result-test",
      autoStartMaintenance: false,
    });
    const program = createRuntimeProgram({
      targets: [review],
      transports: [],
    });
    const host = createWorkHost({ runtime, program });

    const accepted = await host.run(() =>
      spawn(review, { documentId: "doc_1" }, { idempotencyKey: "request_1" }),
    );
    expect(execute).not.toHaveBeenCalled();
    const joined = accepted.result();
    const worker = createRuntimeWorker({ runtime, program });

    try {
      const result = await joined;
      expectTypeOf(result).toEqualTypeOf<{
        documentId: string;
        reviewed: true;
      }>();
      expect(result).toEqual({ documentId: "doc_1", reviewed: true });
      expect(execute).toHaveBeenCalledOnce();
      await expect(accepted.status()).resolves.toMatchObject({
        state: "completed",
        resultAvailable: true,
      });

      const reconnected = await host.run(() => getWork(review, accepted.id));
      await expect(reconnected.result()).resolves.toEqual(result);
    } finally {
      await worker.stop();
      host.dispose();
    }
  });

  it("keeps one terminal result across replayed wakes", async () => {
    let resultVersion = 0;
    const execute = vi.fn(async () => ({ version: ++resultVersion }));
    const review = flow("review-write-once-result", execute);
    const store = inMemoryRuntimeStore();
    const resultPut = vi.spyOn(store.results, "put");
    const runtime = node({
      store,
      namespace: "write-once-result-test",
      autoStartMaintenance: false,
    });
    const program = createRuntimeProgram({ targets: [review], transports: [] });
    const host = createWorkHost({ runtime, program });
    const accepted = await host.run(() =>
      spawn(review, { idempotencyKey: "request_1" }),
    );
    const worker = createRuntimeWorker({ runtime, program });

    try {
      await expect(accepted.result()).resolves.toEqual({ version: 1 });
      const completed = await store.state.getWork(accepted.id as WorkId, {
        namespace: "write-once-result-test",
      });
      const [originalWake] = await store.outbox.listByWork(
        accepted.id as WorkId,
        { namespace: "write-once-result-test" },
      );

      await expect(
        worker.runtime.kernel.handleWake(originalWake!.envelope),
      ).resolves.toMatchObject({ outcome: "duplicate" });
      await expect(
        worker.runtime.kernel.handleWake(originalWake!.envelope),
      ).resolves.toMatchObject({ outcome: "duplicate" });
      await expect(accepted.result()).resolves.toEqual({ version: 1 });
      await expect(
        store.state.getWork(accepted.id as WorkId, {
          namespace: "write-once-result-test",
        }),
      ).resolves.toMatchObject({ resultRef: completed?.resultRef });
      expect(execute).toHaveBeenCalledOnce();
      expect(resultPut).toHaveBeenCalledOnce();
    } finally {
      await worker.stop();
      host.dispose();
    }
  });

  it("exposes suspension and publishes one result after Runtime resume", async () => {
    const review = flow("review-suspended-work", async (scope) => {
      const approval = await scope.suspend<{ readonly approved: true }>(
        "approval",
      );
      expect(approval).toEqual({ approved: true });
      return { decision: "approved" as const };
    });
    const store = inMemoryRuntimeStore();
    const runtime = node({
      store,
      namespace: "suspended-work-test",
      autoStartMaintenance: false,
    });
    const program = createRuntimeProgram({ targets: [review], transports: [] });
    const host = createWorkHost({ runtime, program });
    const accepted = await host.run(() =>
      spawn(review, { idempotencyKey: "request_1" }),
    );
    const worker = createRuntimeWorker({ runtime, program });

    try {
      await waitForState(accepted.status, "suspended");
      const current = await store.state.getWork(accepted.id as WorkId, {
        namespace: "suspended-work-test",
      });
      if (!current || current.work.kind !== "flow.resume") {
        throw new Error("Expected suspended application Flow Work.");
      }
      await expect(
        store.state.getSnapshot(current.work.flowId, {
          namespace: "suspended-work-test",
        }),
      ).resolves.toMatchObject({
        definition: { manifestHash: program.manifestHash },
        resultObligation: { kind: "required" },
      });
      const [waiter] = await store.waiters.listByWork(current.workId);
      if (!waiter) throw new Error("Expected Runtime Flow waiter.");
      await worker.runtime.kernel.emitEvent({
        namespace: "suspended-work-test",
        name: waiter.eventName,
        payload: { approved: true },
      });
      const resumed = await store.state.getWork(current.workId, {
        namespace: "suspended-work-test",
      });
      if (!resumed) throw new Error("Expected resumed Runtime Flow Work.");
      await worker.runtime.kernel.handleWake(wakeEnvelopeForWork(resumed));

      await expect(accepted.result()).resolves.toEqual({
        decision: "approved",
      });
      await expect(accepted.status()).resolves.toMatchObject({
        state: "completed",
        resultAvailable: true,
      });
    } finally {
      await worker.stop();
      host.dispose();
    }
  });

  it("publishes only a safe terminal failure", async () => {
    const privateFailure = "provider secret sk-private-user-payload";
    const review = flow("review-safe-failure", async () => {
      throw new Error(privateFailure);
    });
    const store = inMemoryRuntimeStore();
    const runtime = node({
      store,
      namespace: "safe-failure-test",
      autoStartMaintenance: false,
    });
    const program = createRuntimeProgram({ targets: [review], transports: [] });
    const host = createWorkHost({ runtime, program });
    const accepted = await host.run(() =>
      spawn(review, { idempotencyKey: "request_1" }),
    );
    const pending = await store.state.getWork(accepted.id as WorkId, {
      namespace: "safe-failure-test",
    });
    if (!pending) throw new Error("Expected accepted application Flow Work.");
    await store.state.putWork(Object.freeze({ ...pending, maxAttempts: 1 }));
    const worker = createRuntimeWorker({ runtime, program });

    try {
      await expect(accepted.result()).rejects.toMatchObject({
        code: "work_failed",
        failure: {
          code: "WORK_DEAD_LETTERED",
          message: "Work failed during Flow execution.",
          retryable: false,
        },
      });
      const status = await accepted.status();
      expect(status).toMatchObject({
        state: "failed",
        failure: { message: "Work failed during Flow execution." },
      });
      expect(JSON.stringify(status)).not.toContain(privateFailure);
    } finally {
      await worker.stop();
      host.dispose();
    }
  });
});

async function waitForState(
  status: () => Promise<{ readonly state: string }>,
  expected: string,
): Promise<void> {
  await vi.waitFor(async () => {
    expect((await status()).state).toBe(expected);
  });
}
