import { afterEach, describe, expect, it } from "vitest";
import { config, flow, signal } from "@use-crux/core";
import {
  node,
  runDefaultRuntimeComposite,
  type FlowId,
  type RuntimeCompositeKind,
  type RuntimeStoreAdapter,
  type WorkId,
} from "@use-crux/core/runtime";
import type { SignalOccurrence } from "@use-crux/core/signal";
import { resetHooks } from "../src/runtime/runtime";
import { z } from "zod";
import { registerSignalDurableIdempotencyBehaviors } from "./signal-durable-idempotency.behavior";
import { registerSignalDurableAtomicityBehaviors } from "./signal-durable-atomicity.behavior";
import { registerSignalDurableRecoveryBehaviors } from "./signal-durable-recovery.behavior";
import {
  deferred,
  durableMemoryRuntimeStore,
  expectFlowStatus,
  expectWaiterCounts,
} from "./signal-durable-test-helpers";

afterEach(() => {
  resetHooks();
});

describe("durable Signal Flow delivery", () => {
  it("atomically accepts a Signal occurrence and resumes one waiting Flow", async () => {
    const store = durableMemoryRuntimeStore();
    const crux = config({
      runtime: node({
        store,
        namespace: "signal-flow-test",
        autoStartMaintenance: false,
      }),
    });
    const checksChanged = signal({
      id: "ci.checks.changed",
      schema: z.object({ sha: z.string(), status: z.literal("passed") }),
    });
    const resumed = deferred();
    const finishConsumer = deferred();
    const completed = deferred();
    let delivered:
      | SignalOccurrence<"ci.checks.changed", { sha: string; status: "passed" }>
      | undefined;
    const release = flow(
      "durable release",
      { signals: { checksChanged } },
      async (scope) => {
        delivered = await scope.waitFor(checksChanged);
        resumed.resolve();
        await finishConsumer.promise;
        completed.resolve();
      },
    );

    try {
      const suspended = await release.run({ flowId: "flow_signal_wait" });
      expect(suspended.status).toBe("suspended");

      const receipt = await checksChanged.publish({
        sha: "abc123",
        status: "passed",
      });

      expect(receipt).toMatchObject({
        signalId: "ci.checks.changed",
        guarantee: "durable",
      });
      await resumed.promise;
      expect(delivered).toMatchObject({
        id: receipt.occurrenceId,
        signalId: "ci.checks.changed",
        payload: { sha: "abc123", status: "passed" },
        acceptedAt: receipt.acceptedAt,
      });

      finishConsumer.resolve();
      await completed.promise;
      await expectFlowStatus(
        store,
        "signal-flow-test",
        suspended.flowId,
        "completed",
      );
    } finally {
      finishConsumer.resolve();
      crux.dispose();
    }
  });

  it("uses canonical nested match data when resolving a static Signal wait", async () => {
    const store = durableMemoryRuntimeStore();
    const crux = config({
      runtime: node({
        store,
        namespace: "signal-match-test",
        autoStartMaintenance: false,
      }),
    });
    const changed = signal({
      id: "ci.checks.match",
      schema: z.object({
        check: z.object({ status: z.enum(["passed", "failed"]) }),
      }),
    });
    const passed = changed.when({ check: { status: "passed" } });
    const resumed = deferred();
    const release = flow(
      "matched release",
      { signals: { passed } },
      async (scope) => {
        await scope.waitFor(passed);
        resumed.resolve();
      },
    );

    try {
      await release.run({ flowId: "flow_signal_match" });
      await expect(
        changed.publish({ check: { status: "failed" } }),
      ).resolves.toMatchObject({ guarantee: "process-local" });

      await expect(
        changed.publish({ check: { status: "passed" } }),
      ).resolves.toMatchObject({ guarantee: "durable" });
      await resumed.promise;
      await expectFlowStatus(
        store,
        "signal-match-test",
        "flow_signal_match",
        "completed",
      );
    } finally {
      crux.dispose();
    }
  });

  it("evaluates predicate code in the deployed Flow target without persisting it", async () => {
    const store = durableMemoryRuntimeStore();
    const crux = config({
      runtime: node({
        store,
        namespace: "signal-predicate-test",
        autoStartMaintenance: false,
      }),
    });
    const changed = signal({
      id: "ci.checks.predicate",
      schema: z.object({ status: z.enum(["passed", "failed"]) }),
    });
    let predicateCalls = 0;
    const firstPredicate = deferred();
    const secondPredicate = deferred();
    const passed = changed.when((payload) => {
      predicateCalls += 1;
      if (predicateCalls === 1) firstPredicate.resolve();
      if (predicateCalls === 2) secondPredicate.resolve();
      return payload.status === "passed";
    });
    const resumed = deferred();
    const release = flow(
      "predicate release",
      { signals: { passed } },
      async (scope) => {
        await scope.waitFor(passed);
        resumed.resolve();
      },
    );

    try {
      const suspended = await release.run({ flowId: "flow_signal_predicate" });
      const snapshot = await store.state.getSnapshot(
        suspended.flowId as FlowId,
        { namespace: "signal-predicate-test" },
      );
      expect(snapshot).not.toBeNull();

      await expect(
        changed.publish({ status: "failed" }),
      ).resolves.toMatchObject({ guarantee: "durable" });
      await firstPredicate.promise;
      const waiters = await expectWaiterCounts(store, snapshot!.workId, {
        armed: 1,
        total: 2,
      });
      expect(predicateCalls).toBe(1);
      expect(waiters).toHaveLength(2);
      expect(
        waiters.every((waiter) => !("predicate" in (waiter.source ?? {}))),
      ).toBe(true);

      await expect(
        changed.publish({ status: "passed" }),
      ).resolves.toMatchObject({
        guarantee: "durable",
      });
      await secondPredicate.promise;
      expect(predicateCalls).toBe(2);
      await expectFlowStatus(
        store,
        "signal-predicate-test",
        "flow_signal_predicate",
        "completed",
      );
      await resumed.promise;
    } finally {
      crux.dispose();
    }
  });

  it("atomically binds the Signal waiter to its Flow snapshot through the dedicated composite", async () => {
    const baseStore = durableMemoryRuntimeStore();
    const compositeKinds: RuntimeCompositeKind[] = [];
    const runComposite: NonNullable<RuntimeStoreAdapter["runComposite"]> =
      async (kind, input) => {
        compositeKinds.push(kind);
        return runDefaultRuntimeComposite(
          baseStore,
          {
            now: () => new Date("2026-07-31T23:00:00.000Z"),
            newWorkId: () => "signal_binding_child" as WorkId,
          },
          kind,
          input,
        );
      };
    const store = Object.freeze({ ...baseStore, runComposite });
    const crux = config({
      runtime: node({
        store,
        namespace: "signal-binding-test",
        autoStartMaintenance: false,
      }),
    });
    const changed = signal({
      id: "ci.checks.binding",
      schema: z.object({ check: z.object({ status: z.string() }) }),
    });
    const passed = changed.when({ check: { status: "passed" } });
    const release = flow(
      "bound release",
      { signals: { passed } },
      async (scope) => {
        await scope.waitFor(passed);
      },
    );

    try {
      const suspended = await release.run({ flowId: "flow_signal_binding" });
      const snapshot = await store.state.getSnapshot(
        suspended.flowId as FlowId,
        { namespace: "signal-binding-test" },
      );
      const waiters = await store.waiters.listByWork(snapshot!.workId);

      expect(compositeKinds).toContain("flow.signal-wait.register");
      expect(snapshot?.pendingSuspends).toMatchObject([
        { waiterId: waiters[0]?.waiterId },
      ]);
      expect(waiters).toMatchObject([
        {
          source: {
            kind: "signal",
            signalId: "ci.checks.binding",
            match: { check: { status: "passed" } },
          },
        },
      ]);
    } finally {
      crux.dispose();
    }
  });

  registerSignalDurableIdempotencyBehaviors();
  registerSignalDurableAtomicityBehaviors();
  registerSignalDurableRecoveryBehaviors();
});
