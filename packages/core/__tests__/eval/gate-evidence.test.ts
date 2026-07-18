import { describe, expect, it } from "vitest";
import { evaluateBlockingGates } from "../../src/eval/internal/gates";
import { executeEvalPlan } from "../../src/eval/internal/executor";
import { planEval } from "../../src/eval/internal/planner";
import {
  evalValue,
  nonBillablePlanningPorts,
  taskResult,
} from "./reuse-test-harness";
import { runFixture } from "./baseline-test-harness";

describe("Eval Gate evidence completeness", () => {
  it.each([
    [[], "score_missing"],
    [
      [{ ...runFixture({ score: 1 }).cells[0]!.scores[0]!, value: null }],
      "score_null",
    ],
    [
      [
        {
          status: "errored" as const,
          reason: "scorer_error" as const,
          name: "helpful",
          contractFingerprint: "helpful-v1",
          message: "judge failed",
          work: {
            status: "errored" as const,
            reason: "scorer_error" as const,
            reservation: "consumed" as const,
          },
        },
      ],
      "score_errored",
    ],
  ])("marks unusable score evidence incomplete (%s)", (scores, reason) => {
    const fixture = runFixture({ score: 1 });
    const cells = [{ ...fixture.cells[0]!, scores }];
    expect(
      evaluateBlockingGates(cells, ["current"], {
        scores: { helpful: { min: 0 } },
      }),
    ).toMatchObject({
      passed: false,
      results: [{ passed: false, evidence: "incomplete", reason }],
    });
  });

  it("marks missing cost evidence incomplete and makes the run incomplete", async () => {
    const planned = await planEval(
      evalValue(),
      {
        sourceKey: { relativeFile: "support.eval.ts", export: "default" },
      },
      nonBillablePlanningPorts(),
    );
    const run = await executeEvalPlan(
      { ...planned, gates: { cost: { maxTotalUsd: 1 } } },
      {
        taskHost: { execute: async () => taskResult() },
        clock: { now: () => 1 },
        ids: { next: () => "missing-cost" },
        runStore: { write: async () => undefined },
      },
    );

    expect(run).toMatchObject({
      status: "incomplete",
      passed: false,
      reasons: ["cost_missing"],
      gates: {
        results: [{ evidence: "incomplete", reason: "cost_missing" }],
      },
    });
  });
});
