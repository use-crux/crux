import { describe, expect, it } from "vitest";
import { inMemoryRuntimeStore } from "../../../src/runtime/adapters/memory";
import { createRuntimeKernel } from "../../../src/runtime/engine/kernel";
import type {
  RuntimeTargetId,
  TaskId,
  WorkId,
} from "../../../src/runtime/ports";

describe("Runtime result payload storage", () => {
  it("accepts exactly 1 MiB of canonical JSON and rejects one byte more", async () => {
    const store = inMemoryRuntimeStore();
    const oneMiB = 1024 * 1024;

    await expect(
      store.results.put("x".repeat(oneMiB - 2), { namespace: "tenant-a" }),
    ).resolves.toMatchObject({ size: oneMiB });
    await expect(
      store.results.put("x".repeat(oneMiB - 1), { namespace: "tenant-a" }),
    ).rejects.toMatchObject({ code: "EVAL_RESULT_TOO_LARGE" });
  });

  it("fails closed when a result reference does not match stored content", async () => {
    const store = inMemoryRuntimeStore();
    const ref = await store.results.put(
      { answer: 42 },
      { namespace: "tenant-a" },
    );

    await expect(
      store.results.get({ ...ref, sha256: "0".repeat(64) }),
    ).rejects.toThrow("content-integrity verification");
  });

  it("stores duplicate canonical content idempotently under one reference", async () => {
    const store = inMemoryRuntimeStore();
    const first = await store.results.put(
      { b: 2, a: 1 },
      { namespace: "tenant-a" },
    );
    const duplicate = await store.results.put(
      { a: 1, b: 2 },
      { namespace: "tenant-a" },
    );

    expect(duplicate).toEqual(first);
  });

  it("deletes an unreferenced result idempotently", async () => {
    const store = inMemoryRuntimeStore();
    const ref = await store.results.put(
      { answer: 42 },
      { namespace: "tenant-a" },
    );

    await store.results.delete(ref);
    await store.results.delete(ref);

    await expect(store.results.get(ref)).resolves.toBeNull();
  });

  it("prunes only old unreferenced results within the requested namespace", async () => {
    const store = inMemoryRuntimeStore();
    const orphan = await store.results.put(
      { result: "orphan" },
      { namespace: "tenant-a" },
    );
    const retained = await store.results.put(
      { result: "retained" },
      { namespace: "tenant-a" },
    );
    await store.state.putWork({
      workId: "work_retained_result" as WorkId,
      namespace: "tenant-a",
      work: {
        kind: "task.run",
        taskId: "task_retained_result" as TaskId,
        targetId: "_crux.internal.result" as RuntimeTargetId,
      },
      targetId: "_crux.internal.result" as RuntimeTargetId,
      status: "completed",
      attempt: 1,
      maxAttempts: 1,
      idempotencyKey: "task:work_retained_result",
      resultRef: retained,
      createdAt: new Date("2026-07-16T00:00:00.000Z"),
      updatedAt: new Date("2026-07-16T00:00:00.000Z"),
    });

    await expect(
      store.results.pruneUnreferenced({
        namespace: "tenant-a",
        before: new Date("2999-01-01T00:00:00.000Z"),
        limit: 10,
      }),
    ).resolves.toEqual({ removed: 1, truncated: false });
    await expect(store.results.get(orphan)).resolves.toBeNull();
    await expect(store.results.get(retained)).resolves.toEqual({
      result: "retained",
    });
  });

  it("reclaims orphaned payloads through kernel retention maintenance", async () => {
    const store = inMemoryRuntimeStore();
    const orphan = await store.results.put(
      { result: "orphan" },
      { namespace: "tenant-a" },
    );
    const kernel = createRuntimeKernel({
      store,
      targets: {},
      newWorkId: () => "unused" as WorkId,
      retention: { terminalWork: 0 },
    });

    await kernel.maintenanceTick({
      namespace: "tenant-a",
      now: new Date("2999-01-01T00:00:00.000Z"),
    });

    await expect(store.results.get(orphan)).resolves.toBeNull();
  });
});
