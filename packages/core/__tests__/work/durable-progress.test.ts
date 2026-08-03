import { describe, expect, it } from "vitest";
import { createWorkHost, flow, getWork, spawn } from "@use-crux/core";
import { WorkNotActiveError } from "@use-crux/core/work";
import {
  createRuntimeProgram,
  createRuntimeWorker,
  inMemoryRuntimeStore,
  node,
  type WorkId,
} from "@use-crux/core/runtime";

describe("durable application Work progress", () => {
  it("replaces one safe snapshot across host reconstruction without waking Work", async () => {
    const review = flow("review-progress", async () => "reviewed");
    const store = inMemoryRuntimeStore();
    const program = createRuntimeProgram({ targets: [review], transports: [] });
    const firstHost = createWorkHost({
      runtime: node({
        store,
        namespace: "work-progress-test",
        autoStartMaintenance: false,
      }),
      program,
    });
    const accepted = await firstHost.run(() =>
      spawn(review, { idempotencyKey: "request_1" }),
    );
    const acceptedRow = await store.state.getWork(accepted.id as WorkId, {
      namespace: "work-progress-test",
    });
    if (!acceptedRow) throw new Error("Expected accepted Work.");
    await new Promise((resolve) => setTimeout(resolve, 5));

    await accepted.progress({ message: "Reading", current: 1, total: 3 });
    await expect(accepted.status()).resolves.toMatchObject({
      state: "queued",
      progress: { message: "Reading", current: 1, total: 3 },
    });
    expect((await accepted.status()).progress?.updatedAt).toBeInstanceOf(Date);
    await expect(
      store.state.getWork(accepted.id as WorkId, {
        namespace: "work-progress-test",
      }),
    ).resolves.toMatchObject({ updatedAt: acceptedRow.updatedAt });

    await accepted.progress({ current: 2 });
    const replaced = await accepted.status();
    expect(replaced.progress).toMatchObject({ current: 2 });
    expect(replaced.progress).not.toHaveProperty("message");
    expect(replaced.progress).not.toHaveProperty("total");
    await expect(
      store.outbox.listByWork(accepted.id as WorkId, {
        namespace: "work-progress-test",
      }),
    ).resolves.toHaveLength(1);
    firstHost.dispose();

    const reconstructedHost = createWorkHost({
      runtime: node({
        store,
        namespace: "work-progress-test",
        autoStartMaintenance: false,
      }),
      program,
    });
    const reconnected = await reconstructedHost.run(() =>
      getWork(review, accepted.id),
    );
    await expect(reconnected.status()).resolves.toMatchObject({
      state: "queued",
      progress: { current: 2 },
    });
    reconstructedHost.dispose();
  });

  it("appends one safe ordered progress event without a result payload", async () => {
    const review = flow("review-progress-event", async () => ({
      secret: true,
    }));
    const store = inMemoryRuntimeStore();
    const host = createWorkHost({
      runtime: node({
        store,
        namespace: "work-progress-event-test",
        autoStartMaintenance: false,
      }),
      program: createRuntimeProgram({ targets: [review], transports: [] }),
    });
    const accepted = await host.run(() =>
      spawn(review, { idempotencyKey: "request_1" }),
    );

    await accepted.progress({ message: "Safe", current: 1, total: 2 });

    const { events } = await store.events.read({
      namespace: "work-progress-event-test",
    });
    const event = events.find(
      (candidate) =>
        candidate.name === `crux.work:${accepted.id}` &&
        typeof candidate.payload === "object" &&
        candidate.payload !== null &&
        !Array.isArray(candidate.payload) &&
        candidate.payload.type === "work.progress",
    );
    expect(event).toMatchObject({
      payload: {
        schemaVersion: 1,
        type: "work.progress",
        workId: accepted.id,
        progress: { message: "Safe", current: 1, total: 2 },
      },
    });
    expect(JSON.stringify(event)).not.toContain("secret");
    await expect(
      store.outbox.listByWork(accepted.id as WorkId, {
        namespace: "work-progress-event-test",
      }),
    ).resolves.toHaveLength(1);
    host.dispose();
  });

  it("validates bounded snapshots and rejects updates after terminal state", async () => {
    const review = flow("review-progress-validation", async () => "done");
    const store = inMemoryRuntimeStore();
    const host = createWorkHost({
      runtime: node({
        store,
        namespace: "work-progress-validation-test",
        autoStartMaintenance: false,
      }),
      program: createRuntimeProgram({ targets: [review], transports: [] }),
    });
    const accepted = await host.run(() =>
      spawn(review, { idempotencyKey: "request_1" }),
    );

    await expect(accepted.progress({ current: 2, total: 1 })).rejects.toThrow(
      TypeError,
    );
    await expect(accepted.progress({ current: Number.NaN })).rejects.toThrow(
      TypeError,
    );
    await expect(
      accepted.progress({ message: "x".repeat(1_025) }),
    ).rejects.toThrow(TypeError);
    await accepted.cancel();
    await expect(
      accepted.progress({ message: "Too late" }),
    ).rejects.toBeInstanceOf(WorkNotActiveError);
    host.dispose();
  });

  it("does not replace the original running timestamp", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const review = flow("review-progress-running-time", async () => {
      await gate;
      return "done";
    });
    const store = inMemoryRuntimeStore();
    const runtime = node({
      store,
      namespace: "work-progress-running-time-test",
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
        .toBe("running");
      const running = await accepted.status();
      if (running.state !== "running")
        throw new Error("Expected running Work.");
      await new Promise((resolve) => setTimeout(resolve, 5));
      await accepted.progress({ message: "Still running" });
      await expect(accepted.status()).resolves.toMatchObject({
        state: "running",
        startedAt: running.startedAt,
      });
    } finally {
      release();
      await worker.stop();
      host.dispose();
    }
  });
});
