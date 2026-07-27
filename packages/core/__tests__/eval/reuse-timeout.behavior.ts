import { expect, it, vi } from "vitest";

import { executeEvalPlan } from "../../src/eval/internal/executor";
import { planEval } from "../../src/eval/internal/planner";
import type { EvalExecutionPorts } from "../../src/eval/internal/ports";
import {
  evalValue,
  memoryEvidenceStore,
  planningPorts,
  task,
  taskResult,
} from "./reuse-test-harness";

/** Register exact-evidence behaviors owned by effective timeout identity. */
export function defineTimeoutReuseBehavior(): void {
  it("reuses evidence only under the same effective timeout policy", async () => {
    const evidenceStore = memoryEvidenceStore();
    const hostExecute = vi.fn(async () => taskResult());
    const options = {
      sourceKey: {
        relativeFile: "support.eval.ts",
        export: "default" as const,
      },
    };
    const executionPorts: EvalExecutionPorts = {
      taskHost: { execute: hostExecute },
      clock: { now: () => 1 },
      ids: { next: () => "eval-run-1" },
      runStore: { write: async () => undefined },
      evidenceStore,
    };
    const execute = async (totalMs: number) => {
      const plan = await planEval(
        evalValue(task, { totalMs }),
        options,
        planningPorts(evidenceStore),
      );
      await executeEvalPlan(plan, executionPorts);
      return plan.cells[0]?.action;
    };

    expect(await execute(5_000)).toMatchObject({
      kind: "execute",
      reason: "no_exact_evidence",
    });
    expect(await execute(1_000)).toMatchObject({
      kind: "execute",
      reason: "no_exact_evidence",
    });
    expect(await execute(5_000)).toMatchObject({
      kind: "reuse",
      reason: "exact_evidence",
    });
    expect(hostExecute).toHaveBeenCalledTimes(2);
    expect(evidenceStore.entries.size).toBe(2);
  });
}
