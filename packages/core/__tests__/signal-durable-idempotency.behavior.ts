import { expect, it } from "vitest";
import { config, flow, signal } from "@use-crux/core";
import {
  inMemoryRuntimeStore,
  node,
  decodeSignalPayload,
  type FlowId,
  type InMemoryRuntimeStore,
} from "@use-crux/core/runtime";
import { z } from "zod";

/** Register durable Signal idempotency behaviors in the acceptance suite. */
export function registerSignalDurableIdempotencyBehaviors(): void {
  it("returns the original process-local receipt when a later binding becomes durable", async () => {
    const store = durableMemoryRuntimeStore();
    const crux = config({
      runtime: node({
        store,
        namespace: "signal-cross-guarantee-replay-test",
        autoStartMaintenance: false,
      }),
    });
    const changed = signal({
      id: "ci.checks.cross-guarantee-replay",
      schema: z.object({ sha: z.string() }),
    });
    const release = flow(
      "cross guarantee replay release",
      { signals: { changed } },
      async (scope) => {
        await scope.waitFor(changed);
      },
    );

    try {
      const first = await changed.publish(
        { sha: "same-sha" },
        { idempotencyKey: "cross-guarantee-key" },
      );
      expect(first.guarantee).toBe("process-local");

      const suspended = await release.run({
        flowId: "flow_signal_cross_guarantee_replay",
      });
      const replay = await changed.publish(
        { sha: "same-sha" },
        { idempotencyKey: "cross-guarantee-key" },
      );

      expect(replay).toEqual(first);
      await expect(
        store.signals.getOccurrence(
          "signal-cross-guarantee-replay-test",
          first.occurrenceId,
        ),
      ).resolves.toBeNull();
      const snapshot = await store.state.getSnapshot(
        suspended.flowId as FlowId,
        { namespace: "signal-cross-guarantee-replay-test" },
      );
      expect(snapshot).not.toBeNull();
      await expect(
        store.waiters.listByWork(snapshot!.workId),
      ).resolves.toMatchObject([{ state: "armed" }]);
    } finally {
      crux.dispose();
    }
  });

  it("replays the same durable receipt for the same key and payload", async () => {
    const store = durableMemoryRuntimeStore();
    const crux = config({
      runtime: node({
        store,
        namespace: "signal-idempotency-test",
        autoStartMaintenance: false,
      }),
    });
    const changed = signal({
      id: "ci.checks.idempotent",
      schema: z.object({ sha: z.string() }),
    });
    const listenerCalled = deferred();
    const resumed = deferred();
    let listenerCalls = 0;
    const unsubscribe = changed.subscribe(() => {
      listenerCalls += 1;
      listenerCalled.resolve();
    });
    const release = flow(
      "idempotent release",
      { signals: { changed } },
      async (scope) => {
        await scope.waitFor(changed);
        resumed.resolve();
      },
    );

    try {
      await release.run({ flowId: "flow_signal_idempotent" });
      const first = await changed.publish(
        { sha: "same-sha" },
        { idempotencyKey: "private-retry-key" },
      );
      const replay = await changed.publish(
        { sha: "same-sha" },
        { idempotencyKey: "private-retry-key" },
      );

      expect(replay).toEqual(first);
      await Promise.all([listenerCalled.promise, resumed.promise]);
      expect(listenerCalls).toBe(1);
      const occurrence = await store.signals.getOccurrence(
        "signal-idempotency-test",
        first.occurrenceId,
      );
      expect(occurrence?.idempotencyHash).toBeTypeOf("string");
      expect(occurrence?.idempotencyHash).not.toContain("private-retry-key");
      await expect(
        store.signals.listDeliveries(
          "signal-idempotency-test",
          first.occurrenceId,
        ),
      ).resolves.toHaveLength(1);
    } finally {
      unsubscribe();
      crux.dispose();
    }
  });

  it("rejects conflicting durable reuse without accepting another occurrence", async () => {
    const store = durableMemoryRuntimeStore();
    const crux = config({
      runtime: node({
        store,
        namespace: "signal-conflict-test",
        autoStartMaintenance: false,
      }),
    });
    const changed = signal({
      id: "ci.checks.conflict",
      schema: z.object({ sha: z.string() }),
    });
    const release = flow(
      "conflicting release",
      { signals: { changed } },
      async (scope) => {
        await scope.waitFor(changed);
      },
    );

    try {
      await release.run({ flowId: "flow_signal_conflict" });
      const first = await changed.publish(
        { sha: "first-private-sha" },
        { idempotencyKey: "private-conflict-key" },
      );
      const conflicting = changed.publish(
        { sha: "second-private-sha" },
        { idempotencyKey: "private-conflict-key" },
      );

      await expect(conflicting).rejects.toMatchObject({
        name: "SignalError",
        code: "idempotency_conflict",
      });
      await expect(conflicting).rejects.not.toThrow("private-conflict-key");
      await expect(conflicting).rejects.not.toThrow("second-private-sha");
      const occurrence = await store.signals.getOccurrence(
        "signal-conflict-test",
        first.occurrenceId,
      );
      expect(
        decodeSignalPayload(occurrence!.payload, occurrence!.payloadCodec),
      ).toEqual({ sha: "first-private-sha" });
      await expect(
        store.signals.listDeliveries(
          "signal-conflict-test",
          first.occurrenceId,
        ),
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

function deferred(): { readonly promise: Promise<void>; resolve(): void } {
  let resolvePromise: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: () => resolvePromise() };
}
