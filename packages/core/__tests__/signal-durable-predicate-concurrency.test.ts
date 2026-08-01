import { afterEach, describe, expect, it } from "vitest";
import { config, flow, signal } from "@use-crux/core";
import {
  createRuntime,
  node,
  runDefaultRuntimeComposite,
  type FlowId,
  type RuntimeCompositeKind,
  type RuntimeStoreAdapter,
  type WorkId,
} from "@use-crux/core/runtime";
import { z } from "zod";
import {
  runtimeTargetMap,
  type RuntimeTargetRuntimeRef,
} from "../src/runtime/api/target-registry";
import { resetHooks } from "../src/runtime/runtime";
import {
  deferred,
  durableMemoryRuntimeStore,
  expectFlowStatus,
} from "./signal-durable-test-helpers";

afterEach(() => {
  resetHooks();
});

describe("durable predicate Signal delivery", () => {
  it("queues a match while nonmatch predicate evaluation is blocked", async () => {
    const base = durableMemoryRuntimeStore();
    const resuspended = deferred();
    let suspensionCommits = 0;
    const now = () => new Date("2026-08-01T03:00:00.000Z");
    const runComposite: NonNullable<
      RuntimeStoreAdapter["runComposite"]
    > = async (kind, input) => {
      const result = await runDefaultRuntimeComposite(
        base,
        { now, newWorkId: () => "predicate_child" as WorkId },
        kind,
        input,
      );
      if (
        kind === ("flow.signal-wait.register" satisfies RuntimeCompositeKind)
      ) {
        suspensionCommits += 1;
        if (suspensionCommits === 2) resuspended.resolve();
      }
      return result;
    };
    const store = Object.freeze({ ...base, runComposite });
    const runtime = Object.freeze({
      ...node({
        store,
        namespace: "signal-predicate-race",
        autoStartMaintenance: false,
      }),
      now,
    });
    const crux = config({ runtime });
    const changed = signal({
      id: "ci.checks.predicate-race",
      schema: z.object({ status: z.enum(["passed", "failed"]) }),
    });
    let predicateCalls = 0;
    const passed = changed.when((payload) => {
      predicateCalls += 1;
      return payload.status === "passed";
    });
    const evaluationEntered = deferred();
    const releaseEvaluation = deferred();
    const completed = deferred();
    const observed: string[] = [];
    let executions = 0;
    const consumer = flow(
      "predicate race consumer",
      { signals: { passed } },
      async (scope) => {
        executions += 1;
        if (executions === 2) {
          evaluationEntered.resolve();
          await releaseEvaluation.promise;
        }
        const occurrence = await scope.waitFor(passed);
        observed.push(occurrence.id);
        completed.resolve();
      },
    );

    try {
      const suspended = await consumer.run({ flowId: "flow_predicate_race" });
      const first = await changed.publish({ status: "failed" });
      await evaluationEntered.promise;
      const matching = await changed.publish({ status: "passed" });

      expect(matching.guarantee).toBe("durable");
      const queued = await store.state.getSnapshot(suspended.flowId as FlowId, {
        namespace: "signal-predicate-race",
      });
      const pending = queued!.pendingSuspends[0] as unknown as {
        readonly candidates?: readonly { readonly eventId: string }[];
      };
      expect(pending.candidates?.map(({ eventId }) => eventId)).toEqual([
        first.occurrenceId,
        matching.occurrenceId,
      ]);
      const waiter = (await store.waiters.listByWork(queued!.workId))[0]!;
      expect(waiter.state).toBe("armed");
      expect(waiter.source).toMatchObject({ filterKind: "predicate" });
      expect(waiter.source).not.toHaveProperty("predicate");

      releaseEvaluation.resolve();
      await resuspended.promise;
      const runtimeRef: RuntimeTargetRuntimeRef = {};
      const resumed = createRuntime({
        runtime,
        targets: runtimeTargetMap(runtimeRef),
        startMaintenance: false,
      });
      runtimeRef.current = resumed;
      try {
        await resumed.dispatcher.nudge();
        await completed.promise;
      } finally {
        resumed.dispose();
      }

      await expectFlowStatus(
        store,
        "signal-predicate-race",
        suspended.flowId,
        "completed",
      );
      expect(executions).toBe(3);
      expect(predicateCalls).toBe(2);
      expect(observed).toEqual([matching.occurrenceId]);
      for (const receipt of [first, matching]) {
        await expect(
          store.signals.listDeliveries(
            "signal-predicate-race",
            receipt.occurrenceId,
          ),
        ).resolves.toMatchObject([{ state: "delivered", attempts: 1 }]);
      }
      expect(
        (await store.waiters.listByWork(queued!.workId)).filter(
          ({ state }) => state === "armed",
        ),
      ).toHaveLength(0);
      await expect(
        store.outbox.list({
          namespace: "signal-predicate-race",
          state: "pending",
          limit: 10,
        }),
      ).resolves.toHaveLength(0);
    } finally {
      releaseEvaluation.resolve();
      crux.dispose();
    }
  });
});
