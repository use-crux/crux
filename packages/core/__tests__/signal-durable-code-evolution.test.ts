import { afterEach, describe, expect, it } from "vitest";
import { config, flow, signal } from "@use-crux/core";
import { createRuntime, node, type FlowId } from "@use-crux/core/runtime";
import { z } from "zod";
import {
  runtimeTargetMap,
  type RuntimeTargetRuntimeRef,
} from "../src/runtime/api/target-registry";
import { resetHooks } from "../src/runtime/runtime";
import {
  deferred,
  durableMemoryRuntimeStore,
  expectOutboxState,
} from "./signal-durable-test-helpers";

afterEach(() => {
  resetHooks();
});

describe("durable Signal retry replay", () => {
  it("blocks a retry when a completed post-wait step was removed", async () => {
    const store = durableMemoryRuntimeStore();
    let now = new Date("2026-08-01T02:00:00.000Z");
    const runtime = Object.freeze({
      ...node({
        store,
        namespace: "signal-code-evolution",
        autoStartMaintenance: false,
      }),
      now: () => now,
    });
    const crux = config({ runtime });
    const changed = signal({
      id: "ci.checks.code-evolution",
      schema: z.object({ sha: z.string() }),
    });
    const failed = deferred();
    const original = flow(
      "post-wait retry evolution",
      { signals: { changed } },
      async (scope) => {
        await scope.waitFor(changed);
        await scope.step("post-wait", () => "recorded");
        failed.resolve();
        throw new Error("retry after post-wait step");
      },
    );

    try {
      const suspended = await original.run({
        flowId: "flow_signal_code_evolution",
      });
      await changed.publish({ sha: "evolved" });
      await failed.promise;
      await expectOutboxState(store, "signal-code-evolution", "pending");

      flow(
        "post-wait retry evolution",
        { signals: { changed } },
        async (scope) => {
          await scope.waitFor(changed);
          return "step removed";
        },
      );
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
      } finally {
        restarted.dispose();
      }

      const snapshot = await store.state.getSnapshot(
        suspended.flowId as FlowId,
        { namespace: "signal-code-evolution" },
      );
      await expect(
        store.state.getWork(snapshot!.workId, {
          namespace: "signal-code-evolution",
        }),
      ).resolves.toMatchObject({
        status: "blocked",
        lastError: {
          code: "REPLAY_DIVERGED",
          message: expect.stringContaining("step:post-wait"),
        },
      });
    } finally {
      crux.dispose();
    }
  });
});
