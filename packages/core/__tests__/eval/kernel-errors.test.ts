import { describe, expect, it, vi } from "vitest";

import { evaluate } from "../../src/eval/evaluate";
import { executeEvalPlan } from "../../src/eval/internal/executor";
import { planEval } from "../../src/eval/internal/planner";
import type { EvalExecutionPorts } from "../../src/eval/internal/ports";

const task = Object.assign(async () => "unused", {
  _tag: "CruxTask" as const,
  operation: "function" as const,
});

function definition(overrides: Record<string, unknown> = {}) {
  return evaluate({
    id: "support",
    task,
    cases: [{ id: "refund", input: { question: "yes" } }],
    ...overrides,
  });
}

function plan() {
  return planEval(definition(), {
    sourceKey: { relativeFile: "support.eval.ts", export: "default" },
  });
}

describe("portable Eval kernel failures", () => {
  it("rejects unsupported Case `only` flags before any task work", async () => {
    await expect(
      planEval(
        definition({
          cases: [{ id: "refund", input: { question: "yes" }, only: true }],
        }),
        {
          sourceKey: { relativeFile: "support.eval.ts", export: "default" },
        },
      ),
    ).rejects.toThrow("does not yet support Case `only` flags");
  });

  it("persists an incomplete run after a task-host failure", async () => {
    const writes: unknown[] = [];
    const execute = vi.fn(async () => {
      expect(writes).toHaveLength(0);
      throw new Error("provider unavailable");
    });
    const ports: EvalExecutionPorts = {
      taskHost: { execute },
      clock: { now: vi.fn().mockReturnValueOnce(100).mockReturnValue(125) },
      ids: { next: () => "eval-run-1" },
      runStore: { write: async (run) => void writes.push(run) },
    };

    const run = await executeEvalPlan(await plan(), ports);

    expect(execute).toHaveBeenCalledOnce();
    expect(writes).toEqual([run]);
    expect(run).toMatchObject({
      status: "incomplete",
      passed: false,
      reasons: ["task_error"],
      cells: [
        {
          status: "errored",
          task: { status: "errored", reason: "task_error" },
          error: { phase: "execute", message: "provider unavailable" },
        },
      ],
    });
  });
});
