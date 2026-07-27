import { describe, expect, it } from "vitest";

import { normalizeAdapterCallError } from "../../src/adapter/normalized-outcome";
import { evaluate } from "../../src/eval/evaluate";
import { executeEvalPlan } from "../../src/eval/internal/executor";
import { planEval } from "../../src/eval/internal/planner";
import type { EvalExecutionPorts } from "../../src/eval/internal/ports";
import { TimeoutError } from "../../src/generation/timeout";
import { nonBillablePlanningPorts, taskResult } from "./reuse-test-harness";

/** Register task-boundary classification for canonical nested timeouts. */
export function nestedTimeoutBehavior(): void {
  describe("nested task timeout classification", () => {
    it.each([
      {
        name: "provider step",
        error: () => new TimeoutError({ budget: "step", limitMs: 25 }),
        timeout: { budget: "step", limitMs: 25 },
      },
      {
        name: "named Tool",
        error: () =>
          new TimeoutError({
            budget: "tool",
            limitMs: 40,
            toolName: "search",
          }),
        timeout: { budget: "tool", limitMs: 40, toolName: "search" },
      },
      {
        name: "normalized adapter wrapper",
        error: () =>
          normalizeAdapterCallError(
            new TimeoutError({ budget: "firstToken", limitMs: 15 }),
            { providerId: "fixture" },
          ),
        timeout: { budget: "firstToken", limitMs: 15 },
      },
    ])(
      "maps an uncaught canonical $name timeout",
      async ({ error, timeout }) => {
        const run = await executeWithTaskHost(async () => {
          throw error();
        });

        expect(run).toMatchObject({
          status: "complete",
          passed: false,
          cells: [
            {
              status: "timed_out",
              task: { status: "timed_out" },
              timeout,
            },
          ],
        });
        expect(run).not.toHaveProperty("reasons");
        expect(run.cells[0]).not.toHaveProperty("error");
      },
    );

    it.each([
      {
        name: "name-shaped impostor",
        error: Object.assign(new Error("not canonical"), {
          name: "TimeoutError",
        }),
      },
      {
        name: "user-transformed error",
        error: new Error("translated failure", {
          cause: new TimeoutError({ budget: "step", limitMs: 25 }),
        }),
      },
    ])("keeps a $name as an ordinary task error", async ({ error }) => {
      const run = await executeWithTaskHost(async () => {
        throw error;
      });

      expect(run).toMatchObject({
        status: "incomplete",
        reasons: ["task_error"],
        cells: [{ status: "errored", task: { status: "errored" } }],
      });
    });

    it("allows task code to catch a canonical timeout and recover", async () => {
      const run = await executeWithTaskHost(async () => {
        try {
          throw new TimeoutError({ budget: "step", limitMs: 25 });
        } catch (error) {
          if (!TimeoutError.isInstance(error)) throw error;
          return taskResult("recovered");
        }
      });

      expect(run).toMatchObject({
        status: "complete",
        passed: true,
        cells: [{ status: "passed", output: "recovered" }],
      });
    });
  });
}

async function executeWithTaskHost(
  execute: EvalExecutionPorts["taskHost"]["execute"],
) {
  const evalValue = evaluate({
    id: "nested-timeout",
    task: async () => "unused",
    cases: [{ id: "case", input: undefined }],
  });
  const plan = await planEval(
    evalValue,
    {
      sourceKey: {
        relativeFile: "nested-timeout.eval.ts",
        export: "default",
      },
    },
    nonBillablePlanningPorts(),
  );
  return executeEvalPlan(plan, {
    taskHost: { execute },
    clock: { now: () => 10 },
    ids: { next: () => "nested-timeout-run" },
    runStore: { write: async () => undefined },
  });
}
