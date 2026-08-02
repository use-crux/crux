import { afterEach, describe, expect, it } from "vitest";
import { config, flow, signal } from "@use-crux/core";
import {
  createRuntime,
  node,
  runDefaultRuntimeComposite,
  type FlowId,
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

describe("durable predicate Signal timeout arbitration", () => {
  it("evaluates queued candidates before a due timeout", async () => {
    const base = durableMemoryRuntimeStore();
    const resuspended = deferred();
    let suspensions = 0;
    let now = new Date("2026-08-01T04:00:00.000Z");
    const runComposite: NonNullable<
      RuntimeStoreAdapter["runComposite"]
    > = async (kind, input) => {
      const result = await runDefaultRuntimeComposite(
        base,
        { now: () => now, newWorkId: () => "timeout_child" as WorkId },
        kind,
        input,
      );
      if (kind === "flow.signal-wait.register") {
        suspensions += 1;
        if (suspensions === 2) resuspended.resolve();
      }
      return result;
    };
    const store = Object.freeze({ ...base, runComposite });
    const runtime = Object.freeze({
      ...node({
        store,
        namespace: "signal-predicate-timeout",
        autoStartMaintenance: false,
      }),
      now: () => now,
    });
    const crux = config({ runtime });
    const changed = signal({
      id: "ci.checks.predicate-timeout",
      schema: z.object({ status: z.enum(["passed", "failed"]) }),
    });
    const passed = changed.when((payload) => payload.status === "passed");
    const evaluationEntered = deferred();
    const releaseEvaluation = deferred();
    const completed = deferred();
    let executions = 0;
    let observedId: string | undefined;
    const consumer = flow(
      "predicate timeout consumer",
      { signals: { passed } },
      async (scope) => {
        executions += 1;
        if (executions === 2) {
          evaluationEntered.resolve();
          await releaseEvaluation.promise;
        }
        observedId = (await scope.waitFor(passed, { timeout: "1s" })).id;
        completed.resolve();
      },
    );

    try {
      const suspended = await consumer.run({
        flowId: "flow_predicate_timeout",
      });
      await changed.publish({ status: "failed" });
      await evaluationEntered.promise;
      const matching = await changed.publish({ status: "passed" });
      now = new Date(now.getTime() + 2_000);

      const runtimeRef: RuntimeTargetRuntimeRef = {};
      const resumed = createRuntime({
        runtime,
        targets: runtimeTargetMap(runtimeRef),
        startMaintenance: false,
      });
      runtimeRef.current = resumed;
      try {
        await expect(
          resumed.kernel.scanTimers({
            namespace: "signal-predicate-timeout",
            now,
          }),
        ).resolves.toMatchObject({ fired: 0, skipped: 1 });
        const queued = await store.state.getSnapshot(
          suspended.flowId as FlowId,
          { namespace: "signal-predicate-timeout" },
        );
        const waiter = (await store.waiters.listByWork(queued!.workId))[0]!;
        const timer = (await store.timers.listByWork(queued!.workId))[0]!;
        expect(waiter.state).toBe("armed");
        expect(timer.state).toBe("scheduled");

        releaseEvaluation.resolve();
        await resuspended.promise;
        await resumed.dispatcher.nudge();
        await completed.promise;
      } finally {
        resumed.dispose();
      }

      await expectFlowStatus(
        store,
        "signal-predicate-timeout",
        suspended.flowId,
        "completed",
      );
      expect(observedId).toBe(matching.occurrenceId);
      expect(executions).toBe(3);
    } finally {
      releaseEvaluation.resolve();
      crux.dispose();
    }
  });
});
