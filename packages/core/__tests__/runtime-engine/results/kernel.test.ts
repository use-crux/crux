import { describe, expect, it, vi } from "vitest";
import { inMemoryRuntimeStore } from "../../../src/runtime/adapters/memory";
import {
  createRuntimeKernel,
  wakeEnvelopeForWork,
} from "../../../src/runtime/engine/kernel";
import type {
  RuntimeTargetId,
  TaskId,
  WorkId,
} from "../../../src/runtime/ports";
import { durableTask } from "../../../src/runtime/api/task";
import type { RuntimeResultRef } from "../../../src/runtime/results/types";

describe("RuntimeKernel result references", () => {
  it("commits a canonical content-addressed result reference with completed work", async () => {
    const store = inMemoryRuntimeStore();
    const targetId = "_crux.internal.result" as RuntimeTargetId;
    const payload = { nested: { z: 2, a: 1 }, answer: 42 };
    let executions = 0;
    const kernel = createRuntimeKernel({
      store,
      targets: {
        [targetId]: {
          targetId,
          kind: "task",
          execute: async () => {
            executions += 1;
            return {
              status: "completed",
              resultRef: await store.results.put(payload, {
                namespace: "tenant-a",
              }),
            };
          },
        },
      },
      newWorkId: () => "work_result_1" as WorkId,
    });

    const work = await kernel.enqueueTask({
      namespace: "tenant-a",
      taskId: "task_result_1" as TaskId,
      targetId,
    });

    await expect(kernel.handleWake(wakeEnvelopeForWork(work))).resolves.toEqual(
      { status: 200, outcome: "processed" },
    );

    const completed = await store.state.getWork(work.workId, {
      namespace: "tenant-a",
    });
    expect(completed).toMatchObject({
      status: "completed",
      resultRef: {
        sha256:
          "3b1b8d3c413a91b6ee25e8422b24b8663eecf599d765963d0396cc6cd03d7323",
        size: 36,
        mediaType: "application/vnd.crux.eval-result+json",
      },
    });
    await expect(store.results.get(completed!.resultRef!)).resolves.toEqual({
      answer: 42,
      nested: { a: 1, z: 2 },
    });
    await expect(kernel.handleWake(wakeEnvelopeForWork(work))).resolves.toEqual(
      { status: 200, outcome: "duplicate" },
    );
    expect(executions).toBe(1);
  });

  it("continues discarding arbitrary public durableTask return values", async () => {
    const store = inMemoryRuntimeStore();
    const target = durableTask("_phase17_public_return", {
      run: () => ({ mustNotPersist: true }),
    });
    const kernel = createRuntimeKernel({
      store,
      targets: { [target.targetId]: target },
      newWorkId: () => "work_public_result_1" as WorkId,
    });
    const work = await kernel.enqueueTask({
      namespace: "tenant-a",
      taskId: "task_public_result_1" as TaskId,
      targetId: target.targetId,
      input: null,
    });

    await kernel.handleWake(wakeEnvelopeForWork(work));

    await expect(
      store.state.getWork(work.workId, { namespace: "tenant-a" }),
    ).resolves.toMatchObject({ status: "completed", resultRef: undefined });
  });

  it("prevents a stale lease from replacing the winning result reference", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-07-16T00:00:00.000Z"));
      const store = inMemoryRuntimeStore();
      const targetId = "_crux.internal.fenced-result" as RuntimeTargetId;
      let executions = 0;
      let releaseStale!: () => void;
      let markStaleStarted!: () => void;
      const staleStarted = new Promise<void>((resolve) => {
        markStaleStarted = resolve;
      });
      const staleCanFinish = new Promise<void>((resolve) => {
        releaseStale = resolve;
      });
      const kernel = createRuntimeKernel({
        store,
        targets: {
          [targetId]: {
            targetId,
            kind: "task",
            execute: async () => {
              executions += 1;
              if (executions === 1) {
                markStaleStarted();
                await staleCanFinish;
                return {
                  status: "completed",
                  resultRef: await store.results.put(
                    { worker: "stale" },
                    { namespace: "tenant-a" },
                  ),
                };
              }
              return {
                status: "completed",
                resultRef: await store.results.put(
                  { worker: "winner" },
                  { namespace: "tenant-a" },
                ),
              };
            },
          },
        },
        newWorkId: () => "work_fenced_result_1" as WorkId,
        leaseTtlMs: 1_000,
        leaseExtension: false,
      });
      const work = await kernel.enqueueTask({
        namespace: "tenant-a",
        taskId: "task_fenced_result_1" as TaskId,
        targetId,
      });
      const envelope = wakeEnvelopeForWork(work);

      const staleWake = kernel.handleWake(envelope);
      await staleStarted;
      vi.advanceTimersByTime(1_001);
      await kernel.maintenanceTick({
        namespace: "tenant-a",
        now: new Date("2026-07-16T00:00:01.001Z"),
      });
      await kernel.handleWake(envelope);
      releaseStale();

      await expect(staleWake).resolves.toEqual({
        status: 200,
        outcome: "lease-lost",
      });
      const completed = await store.state.getWork(work.workId, {
        namespace: "tenant-a",
      });
      await expect(store.results.get(completed!.resultRef!)).resolves.toEqual({
        worker: "winner",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves a safe reclaimable blob when the terminal transaction fails", async () => {
    const store = inMemoryRuntimeStore();
    const targetId = "_crux.internal.failed-result-commit" as RuntimeTargetId;
    let storedRef: RuntimeResultRef | undefined;
    const kernel = createRuntimeKernel({
      store,
      targets: {
        [targetId]: {
          targetId,
          kind: "task",
          execute: async ({ work }) => {
            storedRef = await store.results.put(
              { result: "stored-before-commit" },
              { namespace: work.namespace },
            );
            return { status: "completed", resultRef: storedRef };
          },
        },
      },
      newWorkId: () => "work_failed_result_commit" as WorkId,
      rng: () => 0,
    });
    const work = await kernel.enqueueTask({
      namespace: "tenant-a",
      taskId: "task_failed_result_commit" as TaskId,
      targetId,
    });
    store.testing.failAfter(0);

    await expect(kernel.handleWake(wakeEnvelopeForWork(work))).resolves.toEqual(
      { status: 200, outcome: "retry-scheduled" },
    );
    await expect(
      store.state.getWork(work.workId, { namespace: "tenant-a" }),
    ).resolves.toMatchObject({ status: "pending", resultRef: undefined });
    await expect(store.results.get(storedRef!)).resolves.toEqual({
      result: "stored-before-commit",
    });
  });
});
