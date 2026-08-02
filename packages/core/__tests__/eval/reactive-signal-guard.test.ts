import { afterEach, describe, expect, it } from "vitest";
import { config, flow, signal } from "@use-crux/core";
import { node, type FlowId } from "@use-crux/core/runtime";
import { z } from "zod";
import { evaluate } from "../../src/eval/evaluate";
import { executeEvalPlan } from "../../src/eval/internal/executor";
import { planEval } from "../../src/eval/internal/planner";
import { resetHooks } from "../../src/runtime/runtime";
import { hashSignalIdempotencyKey } from "../../src/signal/identity";
import {
  durableMemoryRuntimeStore,
  expectWaiterCounts,
} from "../signal-durable-test-helpers";
import { nonBillablePlanningPorts } from "./reuse-test-harness";

afterEach(() => {
  resetHooks();
});

describe("Eval reactive Signal guard", () => {
  it("rejects durable dispatch before allocating Eval-owned records", async () => {
    const store = durableMemoryRuntimeStore();
    const crux = config({
      runtime: node({
        store,
        namespace: "eval-reactive-guard",
        autoStartMaintenance: false,
      }),
    });
    const localOnly = signal({
      id: "eval.local-only",
      schema: z.object({ value: z.string() }),
    });
    const changed = signal({
      id: "eval.durable-forbidden",
      schema: z.object({ value: z.string() }),
    });
    const consumer = flow(
      "eval guarded consumer",
      { signals: { changed } },
      async (scope) => {
        await scope.waitFor(changed);
      },
    );
    const suspended = await consumer.run({ flowId: "flow_eval_guard" });
    const snapshot = await store.state.getSnapshot(suspended.flowId as FlowId, {
      namespace: "eval-reactive-guard",
    });
    const task = Object.assign(async () => "unused", {
      _tag: "CruxTask" as const,
      operation: "function" as const,
    });
    const evalValue = evaluate({
      id: "reactive-guard",
      task,
      cases: [{ id: "one", input: null }],
    });
    const plan = await planEval(
      evalValue,
      { sourceKey: { relativeFile: "reactive.eval.ts", export: "default" } },
      nonBillablePlanningPorts(),
    );
    let rejected: unknown;
    let localGuarantee: string | undefined;

    try {
      await executeEvalPlan(plan, {
        taskHost: {
          execute: async () => {
            localGuarantee = (await localOnly.publish({ value: "captured" }))
              .guarantee;
            try {
              await changed.publish(
                { value: "must-not-dispatch" },
                { idempotencyKey: "eval-attempt" },
              );
            } catch (error) {
              rejected = error;
              throw error;
            }
            throw new Error("durable Eval publication unexpectedly succeeded");
          },
        },
        clock: { now: () => 1 },
        ids: { next: () => "eval-reactive-run" },
        runStore: { write: async () => undefined },
      });

      expect(localGuarantee).toBe("process-local");
      expect(rejected).toMatchObject({
        name: "CruxRuntimeError",
        code: "EVAL_REACTIVE_DISPATCH_FORBIDDEN",
      });
      await expect(
        store.signals.findOccurrenceByIdempotency(
          "eval-reactive-guard",
          changed.id,
          hashSignalIdempotencyKey(changed.id, "eval-attempt"),
        ),
      ).resolves.toBeNull();
      await expect(
        store.events.read({ namespace: "eval-reactive-guard" }),
      ).resolves.toMatchObject({ events: [] });
      await expect(
        store.outbox.list({
          namespace: "eval-reactive-guard",
          state: "pending",
          limit: 10,
        }),
      ).resolves.toHaveLength(0);
      await expect(
        store.state.getSnapshot(suspended.flowId as FlowId, {
          namespace: "eval-reactive-guard",
        }),
      ).resolves.toMatchObject({ status: "suspended" });
      await expectWaiterCounts(store, snapshot!.workId, {
        armed: 1,
        total: 1,
      });
    } finally {
      crux.dispose();
    }
  });
});
