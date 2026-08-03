import { describe, expect, it, vi } from "vitest";
import { createWorkHost, flow, getWork, spawn } from "@use-crux/core";
import {
  createRuntimeProgram,
  inMemoryRuntimeStore,
  node,
  type WorkId,
} from "@use-crux/core/runtime";

describe("durable application Work admission", () => {
  it("accepts one generated Flow occurrence before execution and reconnects it", async () => {
    const run = vi.fn(
      async (_flow, input: { readonly documentId: string }) => ({
        documentId: input.documentId,
        reviewed: true as const,
      }),
    );
    const review = flow("review-document", run);
    const store = inMemoryRuntimeStore();
    const program = createRuntimeProgram({
      targets: [
        {
          target: review,
          definition: {
            id: "flow:review-document",
            fingerprint: "definition-review-v1",
          },
        },
      ],
      transports: [],
    });
    const host = createWorkHost({
      runtime: node({
        store,
        namespace: "application-test",
        autoStartMaintenance: false,
      }),
      program,
    });

    const accepted = await host.run(() =>
      spawn(review, { documentId: "doc_1" }, { idempotencyKey: "request_1" }),
    );

    expect(run).not.toHaveBeenCalled();
    await expect(accepted.status()).resolves.toMatchObject({
      id: accepted.id,
      state: "queued",
    });
    const runtimeWork = await store.state.getWork(accepted.id as WorkId, {
      namespace: "application-test",
    });
    expect(runtimeWork?.work.kind).toBe("flow.resume");
    if (!runtimeWork || runtimeWork.work.kind !== "flow.resume") {
      throw new Error("Expected accepted Flow runtime work.");
    }
    await expect(
      store.state.getSnapshot(runtimeWork.work.flowId, {
        namespace: "application-test",
      }),
    ).resolves.toMatchObject({
      input: { documentId: "doc_1" },
      definition: {
        definitionId: "flow:review-document",
        fingerprint: "definition-review-v1",
        manifestHash: program.manifestHash,
      },
      resultObligation: { kind: "required" },
    });

    const reconnected = await host.run(() => getWork(review, accepted.id));
    expect(reconnected.id).toBe(accepted.id);
    expect(reconnected.effects).toEqual(accepted.effects);
    expect(run).not.toHaveBeenCalled();

    host.dispose();
  });

  it("replays a compatible idempotent request without another obligation", async () => {
    const review = flow(
      "review-compatible",
      async (
        _flow,
        input: { readonly documentId: string; readonly mode: string },
      ) => input.documentId,
    );
    const store = inMemoryRuntimeStore();
    const firstProgram = createRuntimeProgram({
      targets: [
        {
          target: review,
          definition: {
            id: "flow:review-compatible",
            fingerprint: "definition-compatible-v1",
          },
        },
      ],
      transports: [],
    });
    const firstHost = createWorkHost({
      runtime: node({
        store,
        namespace: "compatible-test",
        autoStartMaintenance: false,
      }),
      program: firstProgram,
    });

    const first = await firstHost.run(() =>
      spawn(
        review,
        { documentId: "doc_1", mode: "careful" },
        { idempotencyKey: "request_1" },
      ),
    );
    firstHost.dispose();

    const deployedProgram = createRuntimeProgram({
      targets: [
        {
          target: review,
          definition: {
            id: "flow:review-compatible",
            fingerprint: "definition-compatible-v2",
          },
        },
      ],
      transports: [],
    });
    const deployedHost = createWorkHost({
      runtime: node({
        store,
        namespace: "compatible-test",
        autoStartMaintenance: false,
      }),
      program: deployedProgram,
    });
    const replay = await deployedHost.run(() =>
      spawn(
        review,
        { mode: "careful", documentId: "doc_1" },
        { idempotencyKey: "request_1" },
      ),
    );

    expect(replay.id).toBe(first.id);
    expect(replay.effects).toEqual(first.effects);
    await expect(
      store.outbox.listByWork(first.id as WorkId, {
        namespace: "compatible-test",
      }),
    ).resolves.toHaveLength(1);
    const runtimeWork = await store.state.getWork(first.id as WorkId, {
      namespace: "compatible-test",
    });
    if (!runtimeWork || runtimeWork.work.kind !== "flow.resume") {
      throw new Error("Expected accepted Flow runtime work.");
    }
    await expect(
      store.state.getSnapshot(runtimeWork.work.flowId, {
        namespace: "compatible-test",
      }),
    ).resolves.toMatchObject({
      definition: { fingerprint: "definition-compatible-v1" },
    });

    deployedHost.dispose();
  });

  it("rejects the same target and key with different normalized input", async () => {
    const review = flow(
      "review-conflict",
      async (_flow, input: { readonly documentId: string }) => input.documentId,
    );
    const store = inMemoryRuntimeStore();
    const host = createWorkHost({
      runtime: node({
        store,
        namespace: "conflict-test",
        autoStartMaintenance: false,
      }),
      program: createRuntimeProgram({ targets: [review], transports: [] }),
    });

    const accepted = await host.run(() =>
      spawn(review, { documentId: "doc_1" }, { idempotencyKey: "request_1" }),
    );

    await expect(
      host.run(() =>
        spawn(review, { documentId: "doc_2" }, { idempotencyKey: "request_1" }),
      ),
    ).rejects.toMatchObject({ code: "WORK_IDEMPOTENCY_CONFLICT" });
    await expect(
      store.outbox.listByWork(accepted.id as WorkId, {
        namespace: "conflict-test",
      }),
    ).resolves.toHaveLength(1);

    host.dispose();
  });

  it("scopes the same caller key independently for each target", async () => {
    const review = flow("review-independent", async () => "reviewed");
    const publish = flow("publish-independent", async () => "published");
    const store = inMemoryRuntimeStore();
    const host = createWorkHost({
      runtime: node({
        store,
        namespace: "target-isolation-test",
        autoStartMaintenance: false,
      }),
      program: createRuntimeProgram({
        targets: [review, publish],
        transports: [],
      }),
    });

    const first = await host.run(() =>
      spawn(review, { idempotencyKey: "request_1" }),
    );
    const second = await host.run(() =>
      spawn(publish, { idempotencyKey: "request_1" }),
    );

    expect(second.id).not.toBe(first.id);
    await expect(first.status()).resolves.toMatchObject({ state: "queued" });
    await expect(second.status()).resolves.toMatchObject({ state: "queued" });

    host.dispose();
  });

  it("rejects getWork when the exported target does not match", async () => {
    const review = flow("review-reconnect", async () => "reviewed");
    const publish = flow("publish-reconnect", async () => "published");
    const host = createWorkHost({
      runtime: node({
        store: inMemoryRuntimeStore(),
        namespace: "target-mismatch-test",
        autoStartMaintenance: false,
      }),
      program: createRuntimeProgram({
        targets: [review, publish],
        transports: [],
      }),
    });
    const accepted = await host.run(() =>
      spawn(review, { idempotencyKey: "request_1" }),
    );

    await expect(
      host.run(() => getWork(publish, accepted.id)),
    ).rejects.toMatchObject({ code: "WORK_TARGET_MISMATCH" });

    host.dispose();
  });

  it("rolls back Work, snapshot, and wake obligation together", async () => {
    const review = flow("review-atomic", async () => "reviewed");
    const store = inMemoryRuntimeStore();
    const host = createWorkHost({
      runtime: node({
        store,
        namespace: "atomic-test",
        autoStartMaintenance: false,
      }),
      program: createRuntimeProgram({ targets: [review], transports: [] }),
    });
    store.testing.failAfter(2);

    await expect(
      host.run(() => spawn(review, { idempotencyKey: "request_1" })),
    ).rejects.toThrow("Injected transaction failure");

    const accepted = await host.run(() =>
      spawn(review, { idempotencyKey: "request_1" }),
    );
    await expect(accepted.status()).resolves.toMatchObject({ state: "queued" });
    await expect(
      store.outbox.listByWork(accepted.id as WorkId, {
        namespace: "atomic-test",
      }),
    ).resolves.toHaveLength(1);

    host.dispose();
  });
});
