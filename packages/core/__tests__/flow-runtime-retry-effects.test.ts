import { afterEach, describe, expect, it } from "vitest";
import { config, flow } from "@use-crux/core";
import {
  effect,
  rollback,
  type EffectScopeRef,
} from "@use-crux/core/effect";
import {
  createRuntime,
  node,
  runtimeTargetMap,
  type RuntimeTargetRuntimeRef,
} from "@use-crux/core/runtime";
import { resetHooks } from "../src/runtime/runtime";
import { durableMemoryRuntimeStore } from "./signal-durable-test-helpers";

afterEach(() => {
  resetHooks();
});

describe("Runtime Flow retry Effects", () => {
  it("retains Effects from a failed attempt through automatic retry", async () => {
    const store = durableMemoryRuntimeStore();
    const namespace = "runtime-flow-retry-effects-test";
    let now = new Date("2026-08-01T08:00:00.000Z");
    const runtime = Object.freeze({
      ...node({ store, namespace, autoStartMaintenance: false }),
      now: () => now,
    });
    const crux = config({ runtime });
    const observedScopes: EffectScopeRef[] = [];
    let attempts = 0;
    let recoveries = 0;
    const recordChange = effect(
      "flow.retry.record-change",
      async () => "recorded",
      { recover: async () => void (recoveries += 1) },
    );
    const retrying = flow("retry Effects preservation", async (scope) => {
      attempts += 1;
      observedScopes.push(scope.effects);
      await scope.step("record change", () => recordChange());
      if (attempts === 1) throw new Error("retry after Effect");
      return "completed";
    });

    try {
      await expect(
        retrying.run({ flowId: "flow_retry_effects" }),
      ).rejects.toThrow("retry after Effect");
      const originalScope = observedScopes[0];
      expect(originalScope).toBeDefined();

      now = new Date(now.getTime() + 10_000);
      const runtimeRef: RuntimeTargetRuntimeRef = {};
      const restarted = createRuntime({
        runtime,
        targets: runtimeTargetMap(runtimeRef),
        startMaintenance: false,
      });
      runtimeRef.current = restarted;
      try {
        await restarted.dispatcher.dispatchBatch({ concurrency: 1 });
        expect(runtimeRef.flowResult).toMatchObject({
          status: "completed",
          output: "completed",
          effects: originalScope,
        });
        if (!runtimeRef.flowResult) {
          throw new Error("Runtime retry did not produce a Flow result.");
        }
        await expect(
          rollback(runtimeRef.flowResult.effects),
        ).resolves.toMatchObject({
          status: "completed",
          scope: originalScope,
          units: [{ status: "recovered" }],
        });
      } finally {
        restarted.dispose();
      }

      expect(observedScopes).toEqual([originalScope, originalScope]);
      expect(recoveries).toBe(1);
    } finally {
      crux.dispose();
    }
  });
});
