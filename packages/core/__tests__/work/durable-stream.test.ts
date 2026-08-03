import { describe, expect, it } from "vitest";
import { createWorkHost, flow, spawn } from "@use-crux/core";
import {
  createRuntimeProgram,
  createRuntimeWorker,
  inMemoryRuntimeStore,
  node,
  type WorkId,
  wakeEnvelopeForWork,
} from "@use-crux/core/runtime";

describe("durable application Work streams", () => {
  it("emits one snapshot then filtered ordered events through terminal state", async () => {
    const first = flow("stream-first", async () => "first");
    const second = flow("stream-second", async () => "second");
    const store = inMemoryRuntimeStore();
    const host = createWorkHost({
      runtime: node({
        store,
        namespace: "work-stream-test",
        autoStartMaintenance: false,
      }),
      program: createRuntimeProgram({
        targets: [first, second],
        transports: [],
      }),
    });
    const observed = await host.run(() =>
      spawn(first, { idempotencyKey: "request_1" }),
    );
    const unrelated = await host.run(() =>
      spawn(second, { idempotencyKey: "request_2" }),
    );
    const iterator = observed.stream()[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: {
        type: "work.snapshot",
        workId: observed.id,
        status: { state: "queued" },
      },
    });

    const progressEvent = iterator.next();
    await unrelated.progress({ message: "Ignore me" });
    await observed.progress({ message: "Halfway", current: 1, total: 2 });
    await expect(progressEvent).resolves.toMatchObject({
      done: false,
      value: {
        type: "work.progress",
        workId: observed.id,
        progress: { message: "Halfway", current: 1, total: 2 },
      },
    });

    const terminalEvent = iterator.next();
    await observed.cancel({ reason: "Stopped" });
    await expect(terminalEvent).resolves.toMatchObject({
      done: false,
      value: {
        type: "work.status",
        workId: observed.id,
        status: { state: "cancelled", reason: "Stopped" },
      },
    });
    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
    host.dispose();
  });

  it("replaces state after an expired cursor and continues to terminal state", async () => {
    const review = flow("stream-expired-cursor", async () => "done");
    const store = inMemoryRuntimeStore();
    const host = createWorkHost({
      runtime: node({
        store,
        namespace: "work-stream-expired-test",
        autoStartMaintenance: false,
      }),
      program: createRuntimeProgram({ targets: [review], transports: [] }),
    });
    const accepted = await host.run(() =>
      spawn(review, { idempotencyKey: "request_1" }),
    );
    const original = accepted.stream()[Symbol.asyncIterator]();
    await original.next();
    const oldEvent = original.next();
    await accepted.progress({ message: "Old" });
    const oldCursor = (await oldEvent).value!.cursor;
    await original.return?.();

    await store.events.prune({
      namespace: "work-stream-expired-test",
      before: new Date(Date.now() + 1_000),
      limit: 100,
    });
    await accepted.progress({ message: "Fresh" });
    const resumed = accepted
      .stream({ after: oldCursor })
      [Symbol.asyncIterator]();

    await expect(resumed.next()).resolves.toMatchObject({
      done: false,
      value: {
        type: "work.snapshot",
        status: { state: "queued", progress: { message: "Fresh" } },
      },
    });
    const terminal = resumed.next();
    await accepted.cancel();
    await expect(terminal).resolves.toMatchObject({
      done: false,
      value: { type: "work.status", status: { state: "cancelled" } },
    });
    await expect(resumed.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
    host.dispose();
  });

  it("streams worker lifecycle states and ends without exposing the result", async () => {
    const review = flow("stream-completion", async () => ({
      privateResult: true,
    }));
    const store = inMemoryRuntimeStore();
    const runtime = node({
      store,
      namespace: "work-stream-completion-test",
      autoStartMaintenance: false,
    });
    const program = createRuntimeProgram({ targets: [review], transports: [] });
    const host = createWorkHost({ runtime, program });
    const accepted = await host.run(() =>
      spawn(review, { idempotencyKey: "request_1" }),
    );
    const iterator = accepted.stream()[Symbol.asyncIterator]();
    await iterator.next();
    const running = iterator.next();
    const worker = createRuntimeWorker({ runtime, program });

    try {
      await expect(running).resolves.toMatchObject({
        done: false,
        value: { type: "work.status", status: { state: "running" } },
      });
      const completed = await iterator.next();
      expect(completed).toMatchObject({
        done: false,
        value: {
          type: "work.status",
          status: { state: "completed", resultAvailable: true },
        },
      });
      expect(JSON.stringify(completed)).not.toContain("privateResult");
      await expect(iterator.next()).resolves.toEqual({
        done: true,
        value: undefined,
      });
    } finally {
      await worker.stop();
      host.dispose();
    }
  });

  it("streams suspension before a later terminal cancellation", async () => {
    const review = flow("stream-suspension", async (scope) => {
      await scope.suspend("approval");
      return "approved";
    });
    const store = inMemoryRuntimeStore();
    const runtime = node({
      store,
      namespace: "work-stream-suspension-test",
      autoStartMaintenance: false,
    });
    const program = createRuntimeProgram({ targets: [review], transports: [] });
    const host = createWorkHost({ runtime, program });
    const accepted = await host.run(() =>
      spawn(review, { idempotencyKey: "request_1" }),
    );
    const iterator = accepted.stream()[Symbol.asyncIterator]();
    await iterator.next();
    const worker = createRuntimeWorker({ runtime, program });

    try {
      await expect(iterator.next()).resolves.toMatchObject({
        value: { type: "work.status", status: { state: "running" } },
      });
      await expect(iterator.next()).resolves.toMatchObject({
        value: { type: "work.status", status: { state: "suspended" } },
      });
      const terminal = iterator.next();
      await accepted.cancel();
      await expect(terminal).resolves.toMatchObject({
        value: { type: "work.status", status: { state: "cancelled" } },
      });
      await expect(iterator.next()).resolves.toEqual({
        done: true,
        value: undefined,
      });
    } finally {
      await worker.stop();
      host.dispose();
    }
  });

  it("streams waiter resumption through the same Work lifecycle", async () => {
    const review = flow("stream-resumption", async (scope) => {
      const approval = await scope.suspend<{ readonly approved: true }>(
        "approval",
      );
      return approval.approved ? "approved" : "rejected";
    });
    const store = inMemoryRuntimeStore();
    const runtime = node({
      store,
      namespace: "work-stream-resumption-test",
      autoStartMaintenance: false,
    });
    const program = createRuntimeProgram({ targets: [review], transports: [] });
    const host = createWorkHost({ runtime, program });
    const accepted = await host.run(() =>
      spawn(review, { idempotencyKey: "request_1" }),
    );
    const iterator = accepted.stream()[Symbol.asyncIterator]();
    await iterator.next();
    const worker = createRuntimeWorker({ runtime, program });

    try {
      await iterator.next();
      await iterator.next();
      const suspended = await store.state.getWork(accepted.id as WorkId, {
        namespace: "work-stream-resumption-test",
      });
      if (!suspended) throw new Error("Expected suspended Work.");
      const [waiter] = await store.waiters.listByWork(suspended.workId);
      if (!waiter) throw new Error("Expected Work waiter.");

      const queued = iterator.next();
      await worker.runtime.kernel.emitEvent({
        namespace: "work-stream-resumption-test",
        name: waiter.eventName,
        payload: { approved: true },
      });
      await expect(queued).resolves.toMatchObject({
        value: { type: "work.status", status: { state: "queued" } },
      });
      const pending = await store.state.getWork(suspended.workId, {
        namespace: "work-stream-resumption-test",
      });
      if (!pending) throw new Error("Expected pending Work.");
      const running = iterator.next();
      await worker.runtime.kernel.handleWake(wakeEnvelopeForWork(pending));
      await expect(running).resolves.toMatchObject({
        value: { type: "work.status", status: { state: "running" } },
      });
      await expect(iterator.next()).resolves.toMatchObject({
        value: { type: "work.status", status: { state: "completed" } },
      });
      await expect(iterator.next()).resolves.toEqual({
        done: true,
        value: undefined,
      });
    } finally {
      await worker.stop();
      host.dispose();
    }
  });
});
