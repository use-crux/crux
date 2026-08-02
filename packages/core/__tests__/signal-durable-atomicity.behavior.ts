import { expect, it, vi } from "vitest";
import { config, flow, signal } from "@use-crux/core";
import {
  createRuntime,
  inMemoryRuntimeStore,
  node,
  runtimeTargetMap,
  type FlowId,
  type InMemoryRuntimeStore,
  type RuntimeTargetRuntimeRef,
} from "@use-crux/core/runtime";
import { z } from "zod";
import { expectFlowStatus } from "./signal-durable-test-helpers";

/** Register injected-fault atomicity behaviors in the acceptance suite. */
export function registerSignalDurableAtomicityBehaviors(): void {
  it("rolls back occurrence and delivery when the atomic commit faults", async () => {
    const store = durableMemoryRuntimeStore();
    const crux = config({
      runtime: node({
        store,
        namespace: "signal-atomicity-test",
        autoStartMaintenance: false,
      }),
    });
    const changed = signal({
      id: "ci.checks.atomicity",
      schema: z.object({ sha: z.string() }),
    });
    const release = flow(
      "atomic release",
      { signals: { changed } },
      async (scope) => {
        await scope.waitFor(changed);
      },
    );
    const randomUuid = vi
      .spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValue("atomic-fault");

    try {
      const suspended = await release.run({ flowId: "flow_signal_atomicity" });
      store.testing.failAfter(6);

      await expect(changed.publish({ sha: "atomic-sha" })).rejects.toThrow(
        "Injected transaction failure",
      );
      await expect(
        store.signals.getOccurrence(
          "signal-atomicity-test",
          "signal_occurrence_atomic-fault",
        ),
      ).resolves.toBeNull();
      await expect(
        store.signals.listDeliveries(
          "signal-atomicity-test",
          "signal_occurrence_atomic-fault",
        ),
      ).resolves.toHaveLength(0);
      await expect(
        store.events.read({ namespace: "signal-atomicity-test" }),
      ).resolves.toMatchObject({ events: [] });
      await expect(
        store.state.getSnapshot(suspended.flowId as FlowId, {
          namespace: "signal-atomicity-test",
        }),
      ).resolves.toMatchObject({ status: "suspended" });
    } finally {
      randomUuid.mockRestore();
      crux.dispose();
    }
  });

  it("replays acceptance after a crash between commit and outbox confirmation", async () => {
    const store = durableMemoryRuntimeStore();
    let now = new Date("2026-07-31T22:00:00.000Z");
    const runtimeDefinition = Object.freeze({
      ...node({
        store,
        namespace: "signal-after-commit-test",
        autoStartMaintenance: false,
      }),
      now: () => now,
    });
    const crux = config({ runtime: runtimeDefinition });
    const changed = signal({
      id: "ci.checks.after-commit",
      schema: z.object({ sha: z.string() }),
    });
    const completed = deferred();
    let handlerCalls = 0;
    const release = flow(
      "after commit release",
      { signals: { changed } },
      async (scope) => {
        await scope.waitFor(changed);
        handlerCalls += 1;
        completed.resolve();
      },
    );

    try {
      await release.run({ flowId: "flow_signal_after_commit" });
      store.testing.crashBeforeConfirm();
      const first = await changed.publish(
        { sha: "committed-sha" },
        { idempotencyKey: "after-commit-key" },
      );
      await completed.promise;
      await expectFlowStatus(
        store,
        "signal-after-commit-test",
        "flow_signal_after_commit",
        "completed",
      );
      await expectPendingOutbox(store, "signal-after-commit-test");

      // Replay remains tied to the durable occurrence after its consumer is
      // terminal and no armed waiter remains.
      await expect(
        changed.publish(
          { sha: "committed-sha" },
          { idempotencyKey: "after-commit-key" },
        ),
      ).resolves.toEqual(first);

      now = new Date(now.getTime() + 10_000);
      const runtimeRef: RuntimeTargetRuntimeRef = {};
      const restarted = createRuntime({
        runtime: runtimeDefinition,
        targets: runtimeTargetMap(runtimeRef),
        startMaintenance: false,
      });
      runtimeRef.current = restarted;
      try {
        await expect(restarted.dispatcher.nudge()).resolves.toMatchObject({
          delivered: 1,
          failed: 0,
        });
      } finally {
        restarted.dispose();
      }

      expect(handlerCalls).toBe(1);
      await expect(
        store.signals.listDeliveries(
          "signal-after-commit-test",
          first.occurrenceId,
        ),
      ).resolves.toMatchObject([{ state: "delivered", attempts: 1 }]);
      await expect(
        store.outbox.list({
          namespace: "signal-after-commit-test",
          state: "confirmed",
          limit: 10,
        }),
      ).resolves.toHaveLength(1);
    } finally {
      crux.dispose();
    }
  });
}

function durableMemoryRuntimeStore(): InMemoryRuntimeStore {
  return Object.freeze({
    ...inMemoryRuntimeStore(),
    durability: "durable" as const,
  });
}

async function expectPendingOutbox(
  store: InMemoryRuntimeStore,
  namespace: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const rows = await store.outbox.list({
      namespace,
      state: "pending",
      limit: 10,
    });
    if (rows.length > 0) return;
    await Promise.resolve();
  }
  await expect(
    store.outbox.list({ namespace, state: "pending", limit: 10 }),
  ).resolves.not.toHaveLength(0);
}

function deferred(): { readonly promise: Promise<void>; resolve(): void } {
  let resolvePromise: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: () => resolvePromise() };
}
