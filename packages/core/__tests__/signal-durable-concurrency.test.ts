import { afterEach, describe, expect, it } from "vitest";
import { config, flow, signal } from "@use-crux/core";
import {
  createRuntimeKernel,
  dispatchBatch,
  node,
  type FlowId,
  type RuntimeStoreAdapter,
  type RuntimeStoreTransaction,
  type RuntimeTargetId,
  type TaskId,
  type WorkId,
  wakeEnvelopeForWork,
} from "@use-crux/core/runtime";
import { resetHooks } from "../src/runtime/runtime";
import { z } from "zod";
import {
  deferred,
  durableMemoryRuntimeStore,
  expectFlowStatus,
} from "./signal-durable-test-helpers";

afterEach(() => {
  resetHooks();
});

describe("durable Signal concurrency", () => {
  it("does not lose an occurrence racing a manual Flow resume", async () => {
    const control = controlledCommitStore();
    const crux = config({
      runtime: node({
        store: control.store,
        namespace: "signal-manual-resume-race",
        autoStartMaintenance: false,
      }),
    });
    const changed = signal({
      id: "ci.checks.manual-resume-race",
      schema: z.object({ sha: z.string() }),
    });
    const finishStaleExecution = deferred();
    const observed: string[] = [];
    let executions = 0;
    const release = flow(
      "manual resume race release",
      { signals: { changed } },
      async (scope) => {
        executions += 1;
        if (executions === 2) {
          control.release();
          await finishStaleExecution.promise;
        }
        const occurrence = await scope.waitFor(changed);
        observed.push(occurrence.id);
      },
    );

    try {
      const suspended = await release.run({
        flowId: "flow_signal_manual_resume_race",
      });
      control.blockNextCommit();
      const publishing = changed.publish({ sha: "race-sha" });
      await control.commitReady.promise;

      const resuming = release.resume(suspended.flowId);
      const receipt = await publishing;
      finishStaleExecution.resolve();
      await Promise.allSettled([resuming]);

      await expectFlowStatus(
        control.store,
        "signal-manual-resume-race",
        suspended.flowId,
        "completed",
      );
      expect(observed).toEqual([receipt.occurrenceId]);

      const snapshot = await control.store.state.getSnapshot(
        suspended.flowId as FlowId,
        { namespace: "signal-manual-resume-race" },
      );
      const waiters = await control.store.waiters.listByWork(snapshot!.workId);
      expect(waiters.filter(({ state }) => state === "armed")).toHaveLength(0);
      await expect(
        control.store.signals.listDeliveries(
          "signal-manual-resume-race",
          receipt.occurrenceId,
        ),
      ).resolves.toMatchObject([{ state: "delivered", attempts: 1 }]);
      await expect(
        control.store.outbox.list({
          namespace: "signal-manual-resume-race",
          state: "pending",
          limit: 10,
        }),
      ).resolves.toHaveLength(0);
    } finally {
      control.release();
      finishStaleExecution.resolve();
      crux.dispose();
    }
  });

  it("keeps an in-process wake retryable while its work is leased", async () => {
    const store = durableMemoryRuntimeStore();
    const runtime = node({ store, autoStartMaintenance: false });
    const now = () => new Date("2026-08-01T00:00:00.000Z");
    const kernel = createRuntimeKernel({
      store,
      targets: {
        "busy-target": {
          targetId: "busy-target" as RuntimeTargetId,
          kind: "task",
          execute: async () => ({ status: "completed" }),
        },
      },
      newWorkId: () => "work_busy_signal" as WorkId,
      now,
    });
    const work = await kernel.enqueueTask({
      namespace: "signal-busy-wake",
      taskId: "task_busy_signal" as TaskId,
      targetId: "busy-target" as RuntimeTargetId,
    });
    await store.leases.claim(`work:${work.workId}`, { ttlMs: 60_000 });
    await store.outbox.put(wakeEnvelopeForWork(work), { deliverAt: now() });

    await expect(
      dispatchBatch({
        store,
        deliver: runtime.createWake({
          store,
          kernel,
          namespace: "signal-busy-wake",
          now,
        }),
        namespace: "signal-busy-wake",
        now,
        rng: () => 0,
      }),
    ).resolves.toEqual({ delivered: 0, failed: 1 });
    await expect(
      store.outbox.list({
        namespace: "signal-busy-wake",
        state: "pending",
        limit: 10,
      }),
    ).resolves.toHaveLength(1);
  });

  it("transfers a manual resume to one fresh waiter and timer", async () => {
    const store = durableMemoryRuntimeStore();
    const crux = config({
      runtime: node({
        store,
        namespace: "signal-manual-transfer",
        autoStartMaintenance: false,
      }),
    });
    const changed = signal({
      id: "ci.checks.manual-transfer",
      schema: z.object({ sha: z.string() }),
    });
    const release = flow(
      "manual resume transfer",
      { signals: { changed } },
      async (scope) => {
        await scope.waitFor(changed, { timeout: "1h" });
      },
    );

    try {
      const first = await release.run({ flowId: "flow_manual_transfer" });
      const firstSnapshot = await store.state.getSnapshot(
        first.flowId as FlowId,
        { namespace: "signal-manual-transfer" },
      );
      const oldWaiterId = firstSnapshot!.pendingSuspends[0]!.waiterId;
      const oldTimerId = firstSnapshot!.pendingSuspends[0]!.timerId;

      await expect(release.resume(first.flowId)).resolves.toMatchObject({
        status: "suspended",
      });

      const waiters = await store.waiters.listByWork(firstSnapshot!.workId);
      const timers = await store.timers.listByWork(firstSnapshot!.workId);
      expect(waiters.filter(({ state }) => state === "armed")).toHaveLength(1);
      expect(timers.filter(({ state }) => state === "scheduled")).toHaveLength(
        1,
      );
      expect(
        waiters.find(({ waiterId }) => waiterId === oldWaiterId)?.state,
      ).toBe("cancelled");
      expect(timers.find(({ timerId }) => timerId === oldTimerId)?.state).toBe(
        "cancelled",
      );
      await expect(
        store.outbox.list({
          namespace: "signal-manual-transfer",
          state: "pending",
          limit: 10,
        }),
      ).resolves.toHaveLength(0);
    } finally {
      crux.dispose();
    }
  });
});

function controlledCommitStore(): {
  readonly store: ReturnType<typeof durableMemoryRuntimeStore>;
  readonly commitReady: ReturnType<typeof deferred>;
  blockNextCommit(): void;
  release(): void;
} {
  const base = durableMemoryRuntimeStore();
  const commitReady = deferred();
  const releaseCommit = deferred();
  let blockNext = false;
  let blocking = false;
  const transact = async <T>(
    fn: (tx: RuntimeStoreTransaction) => Promise<T>,
  ): Promise<T> => {
    if (!blockNext || blocking) {
      if (blocking) releaseCommit.resolve();
      return base.transact(fn);
    }
    blockNext = false;
    blocking = true;
    try {
      return await base.transact(async (tx) => {
        const result = await fn(tx);
        commitReady.resolve();
        await releaseCommit.promise;
        return result;
      });
    } finally {
      blocking = false;
    }
  };
  const store = Object.freeze({
    ...base,
    transact,
  }) satisfies RuntimeStoreAdapter as ReturnType<
    typeof durableMemoryRuntimeStore
  >;
  return {
    store,
    commitReady,
    blockNextCommit: () => {
      blockNext = true;
    },
    release: () => releaseCommit.resolve(),
  };
}
