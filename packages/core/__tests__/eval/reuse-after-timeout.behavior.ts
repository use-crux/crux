import { describe, expect, it, vi } from "vitest";

import { executeEvalPlan } from "../../src/eval/internal/executor";
import { planEval } from "../../src/eval/internal/planner";
import { TimeoutError } from "../../src/generation/timeout";
import { observe } from "../../src/observability";
import {
  evalValue,
  memoryEvidenceStore,
  planningPorts,
  taskResult,
} from "./reuse-test-harness";

/** Register the invariant that terminal timeout work is never reusable. */
export function reuseAfterTimeoutBehavior(): void {
  describe("task evidence after timeout", () => {
    it("executes the next identical Eval after partial observed timeout work", async () => {
      const evidenceStore = memoryEvidenceStore();
      const options = {
        sourceKey: {
          relativeFile: "support.eval.ts",
          export: "default" as const,
        },
      };
      const firstPlan = await planEval(
        evalValue(undefined, { stepMs: 25 }),
        options,
        planningPorts(evidenceStore),
      );
      const first = await executeEvalPlan(firstPlan, {
        taskHost: {
          execute: async () => {
            const run = observe.openRun({
              name: "partial managed task",
              rootPrimitive: "eval.case",
            });
            run.withContext(() =>
              observe.openSpan({
                name: "partial generation",
                primitive: "generation.call",
              }),
            );
            throw new TimeoutError({ budget: "step", limitMs: 25 });
          },
        },
        clock: { now: () => 25 },
        ids: { next: () => "timed-out-run" },
        runStore: { write: async () => undefined },
        evidenceStore,
      });

      expect(first.cells[0]).toMatchObject({
        status: "timed_out",
        timeout: { budget: "step", limitMs: 25 },
        capturedSignals: ["modelCalls"],
      });
      expect(first.cells[0]?.runIds).toHaveLength(1);
      expect(evidenceStore.entries.size).toBe(0);

      const secondPlan = await planEval(
        evalValue(undefined, { stepMs: 25 }),
        options,
        planningPorts(evidenceStore),
      );
      expect(secondPlan.cells[0]?.action).toMatchObject({
        kind: "execute",
        reason: "no_exact_evidence",
      });
      const secondExecute = vi.fn(async () => taskResult("fresh"));
      const second = await executeEvalPlan(secondPlan, {
        taskHost: { execute: secondExecute },
        clock: { now: () => 50 },
        ids: { next: () => "fresh-run" },
        runStore: { write: async () => undefined },
        evidenceStore,
      });

      expect(secondExecute).toHaveBeenCalledOnce();
      expect(second.cells[0]).toMatchObject({
        status: "passed",
        output: "fresh",
        task: { status: "executed" },
      });
      expect(evidenceStore.entries.size).toBe(1);
    });
  });
}
