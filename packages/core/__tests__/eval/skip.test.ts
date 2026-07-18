import { describe, expect, it, vi } from "vitest";

import { evaluate } from "../../src/eval/evaluate";
import {
  buildEvalBaseline,
  compareEvalRunToBaseline,
} from "../../src/eval/internal/baseline";
import { executeEvalPlan } from "../../src/eval/internal/executor";
import { planEval } from "../../src/eval/internal/planner";

describe("source-skipped Eval Cases", () => {
  it("does no work, records skip provenance, and detects skip-state drift", async () => {
    const task = Object.assign(async () => "unused", {
      _tag: "CruxTask" as const,
      operation: "function" as const,
    });
    const value = evaluate({
      id: "support",
      task,
      cases: [{ id: "refund", input: {}, skip: "not supported on Windows" }],
    });
    const plan = await planEval(value, {
      sourceKey: { relativeFile: "evals/support.eval.ts", export: "default" },
    });
    expect(plan.cells[0]?.action).toEqual({
      kind: "skip",
      reason: "source_skipped",
      detail: "not supported on Windows",
    });
    expect(plan.cost.actions).toEqual([]);

    const execute = vi.fn();
    const run = await executeEvalPlan(plan, {
      taskHost: { execute },
      clock: { now: vi.fn().mockReturnValueOnce(1).mockReturnValue(2) },
      ids: { next: () => "run-skip" },
      runStore: { write: async () => undefined },
    });
    expect(execute).not.toHaveBeenCalled();
    expect(run).toMatchObject({
      status: "complete",
      passed: true,
      cells: [
        {
          status: "skipped",
          skipReason: "not supported on Windows",
          task: { status: "skipped", reason: "source_skipped" },
        },
      ],
      aggregates: { current: { cells: 0, skipped: 1 } },
    });

    const baseline = buildEvalBaseline(run, {
      baselineId: "baseline-skip",
      promotedAt: 3,
      toolVersion: "0.5.0",
    });
    expect(baseline).toMatchObject({
      coverage: [],
      skippedCases: [{ caseId: "refund", reason: "not supported on Windows" }],
    });
    const active = {
      ...run,
      cells: [
        {
          ...run.cells[0]!,
          status: "passed" as const,
          task: {
            status: "executed" as const,
            reason: "live_required" as const,
          },
          skipReason: undefined,
        },
      ],
    };
    expect(compareEvalRunToBaseline(active, baseline)).toMatchObject({
      cases: [
        {
          caseId: "refund",
          status: "incompatible",
          reason: "skip_state_changed",
        },
      ],
    });
  });
});
