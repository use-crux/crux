import { describe, expect, it } from "vitest";
import { createWorkHost, flow, spawn } from "@use-crux/core";
import {
  createRuntimeProgram,
  createRuntimeWorker,
  inMemoryRuntimeStore,
  node,
  type WorkId,
} from "@use-crux/core/runtime";

describe("durable application Work stream cursors", () => {
  it("delivers a terminal event committed after an empty cursor read", async () => {
    const review = flow("stream-terminal-read-race", async () => "done");
    const store = inMemoryRuntimeStore();
    const host = createWorkHost({
      runtime: node({
        store,
        namespace: "work-stream-terminal-read-race-test",
        autoStartMaintenance: false,
      }),
      program: createRuntimeProgram({ targets: [review], transports: [] }),
    });
    const accepted = await host.run(() =>
      spawn(review, { idempotencyKey: "request_1" }),
    );
    const original = accepted.stream()[Symbol.asyncIterator]();
    await original.next();
    const progress = original.next();
    await accepted.progress({ message: "Checkpoint" });
    const checkpoint = await progress;
    if (checkpoint.done) throw new Error("Expected a progress checkpoint.");
    await original.return?.();

    const read = store.events.read.bind(store.events);
    let commitTerminal = true;
    store.events.read = async (options) => {
      const page = await read(options);
      if (commitTerminal && options.after === checkpoint.value.cursor) {
        commitTerminal = false;
        await accepted.cancel();
      }
      return page;
    };
    const resumed = accepted
      .stream({ after: checkpoint.value.cursor })
      [Symbol.asyncIterator]();

    try {
      await expect(resumed.next()).resolves.toMatchObject({
        done: false,
        value: { type: "work.status", status: { state: "cancelled" } },
      });
      await expect(resumed.next()).resolves.toEqual({
        done: true,
        value: undefined,
      });
    } finally {
      store.events.read = read;
      host.dispose();
    }
  });

  it("ends immediately when resuming after a consumed terminal status", async () => {
    const review = flow("stream-terminal-cursor", async () => "done");
    const host = createWorkHost({
      runtime: node({
        store: inMemoryRuntimeStore(),
        namespace: "work-stream-terminal-cursor-test",
        autoStartMaintenance: false,
      }),
      program: createRuntimeProgram({ targets: [review], transports: [] }),
    });
    const accepted = await host.run(() =>
      spawn(review, { idempotencyKey: "request_1" }),
    );
    const original = accepted.stream()[Symbol.asyncIterator]();
    await original.next();
    const terminal = original.next();
    await accepted.cancel();
    const delivered = await terminal;
    if (delivered.done) throw new Error("Expected a terminal status event.");
    await original.return?.();

    const resumed = accepted
      .stream({ after: delivered.value.cursor })
      [Symbol.asyncIterator]();
    await expect(
      Promise.race([
        resumed.next(),
        new Promise<"timed-out">((resolve) =>
          setTimeout(() => resolve("timed-out"), 50),
        ),
      ]),
    ).resolves.toEqual({ done: true, value: undefined });
    host.dispose();
  });

  it("continues strictly after a retained opaque cursor without another snapshot", async () => {
    const review = flow("stream-retained-cursor", async () => "done");
    const store = inMemoryRuntimeStore();
    const host = createWorkHost({
      runtime: node({
        store,
        namespace: "work-stream-retained-cursor-test",
        autoStartMaintenance: false,
      }),
      program: createRuntimeProgram({ targets: [review], transports: [] }),
    });
    const accepted = await host.run(() =>
      spawn(review, { idempotencyKey: "request_1" }),
    );
    const initial = accepted.stream()[Symbol.asyncIterator]();
    await initial.next();
    const progress = initial.next();
    await accepted.progress({ message: "Checkpoint" });
    const checkpoint = await progress;
    if (checkpoint.done) throw new Error("Expected a progress checkpoint.");
    await initial.return?.();

    const resumed = accepted
      .stream({ after: checkpoint.value.cursor })
      [Symbol.asyncIterator]();
    const next = resumed.next();
    await accepted.cancel();
    await expect(next).resolves.toMatchObject({
      done: false,
      value: { type: "work.status", status: { state: "cancelled" } },
    });
    await expect(resumed.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
    host.dispose();
  });

  it("ends on a safe failed event without exposing the raw failure", async () => {
    const privateFailure = "private provider response";
    const review = flow("stream-safe-failure", async () => {
      throw new Error(privateFailure);
    });
    const store = inMemoryRuntimeStore();
    const runtime = node({
      store,
      namespace: "work-stream-safe-failure-test",
      autoStartMaintenance: false,
    });
    const program = createRuntimeProgram({ targets: [review], transports: [] });
    const host = createWorkHost({ runtime, program });
    const accepted = await host.run(() =>
      spawn(review, { idempotencyKey: "request_1" }),
    );
    const pending = await store.state.getWork(accepted.id as WorkId, {
      namespace: "work-stream-safe-failure-test",
    });
    if (!pending) throw new Error("Expected accepted Work.");
    await store.state.putWork(Object.freeze({ ...pending, maxAttempts: 1 }));
    const iterator = accepted.stream()[Symbol.asyncIterator]();
    await iterator.next();
    const worker = createRuntimeWorker({ runtime, program });

    try {
      await expect(iterator.next()).resolves.toMatchObject({
        value: { type: "work.status", status: { state: "running" } },
      });
      const failed = await iterator.next();
      expect(failed).toMatchObject({
        done: false,
        value: { type: "work.status", status: { state: "failed" } },
      });
      expect(JSON.stringify(failed)).not.toContain(privateFailure);
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
