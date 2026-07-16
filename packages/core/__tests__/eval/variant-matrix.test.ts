import { describe, expect, it } from "vitest";

import { evaluate } from "../../src/eval/evaluate";
import { executeEvalPlan } from "../../src/eval/internal/executor";
import { planEval } from "../../src/eval/internal/planner";
import type { EvalExecutionPorts } from "../../src/eval/internal/ports";

const task = Object.assign(async () => "unused", {
  _tag: "CruxTask" as const,
  operation: "function" as const,
});

describe("Eval Case × Variant × trial matrix", () => {
  it("expands inline Cases, arms, and trials in stable nested order", async () => {
    const evalValue = evaluate({
      id: "support",
      task,
      cases: [
        { id: "refund", input: { answer: "yes" }, trials: 2 },
        { input: { answer: "also yes" } },
      ],
      variants: { cheaper: { temperature: 0 } },
      trials: 1,
      expect: ({ input, output, expect: assert }) =>
        assert(output).toBe(input.answer),
    });
    const plan = await planEval(evalValue, {
      sourceKey: { relativeFile: "support.eval.ts", export: "default" },
    });

    expect(
      plan.cells.map((cell) => [cell.caseId, cell.variant, cell.trial]),
    ).toEqual([
      ["refund", "current", 0],
      ["refund", "current", 1],
      ["refund", "cheaper", 0],
      ["refund", "cheaper", 1],
      [plan.selection.cases[1], "current", 0],
      [plan.selection.cases[1], "cheaper", 0],
    ]);
    expect(plan.selection.cases[1]).toMatch(/^[a-f0-9]{64}$/);

    const ports: EvalExecutionPorts = {
      taskHost: {
        execute: async (request) => ({
          output: request.input.answer,
          response: {
            content: [],
            text: request.input.answer,
            steps: [],
            finalStep: {
              content: [],
              text: request.input.answer,
              finishReason: "stop",
              responseId: `${request.caseId}:${request.variant}:${request.trial}`,
              modelId: "fake",
              warnings: [],
            },
            messages: [],
            warnings: [],
          },
          capturedSignals: [],
          runIds: [],
          metrics: { durationMs: 1 },
          observedIdentity: {
            reusable: false,
            reason: "identity_unavailable",
          },
        }),
      },
      clock: { now: () => 1 },
      ids: { next: () => "eval-run-1" },
      runStore: { write: async () => undefined },
    };
    const run = await executeEvalPlan(plan, ports);

    expect(run.aggregates).toMatchObject({
      current: { cells: 3, passed: 3 },
      cheaper: { cells: 3, passed: 3 },
    });
  });

  it("rejects duplicate derived Case identities and invalid trials before work", async () => {
    const duplicate = evaluate({
      id: "support",
      task,
      cases: [{ input: { answer: "yes" } }, { input: { answer: "yes" } }],
    });
    await expect(
      planEval(duplicate, {
        sourceKey: { relativeFile: "support.eval.ts", export: "default" },
      }),
    ).rejects.toThrow("duplicate Case id");

    const invalidTrials = evaluate({
      id: "support",
      task,
      cases: [{ input: { answer: "yes" } }],
      trials: 0,
    });
    await expect(
      planEval(invalidTrials, {
        sourceKey: { relativeFile: "support.eval.ts", export: "default" },
      }),
    ).rejects.toThrow("trials must be a positive integer");
  });
});
