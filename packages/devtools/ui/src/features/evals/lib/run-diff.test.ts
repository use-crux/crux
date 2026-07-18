import { describe, expect, it } from "vitest";
import type { EvalRunRecord } from "../types";
import { compareEvalRuns } from "./run-diff";

describe("Eval run comparison", () => {
  it("diffs matching trials and score evidence without collapsing them", () => {
    const left = run("run-a", [
      cell(0, "passed", 20, 0.9),
      cell(1, "passed", 30, 0.8),
    ]);
    const right = run("run-b", [
      cell(0, "failed", 25, 0.4),
      cell(1, "passed", 28, 0.8),
    ]);

    expect(compareEvalRuns(left, right)).toEqual({
      fromRunId: "run-a",
      toRunId: "run-b",
      cells: [
        {
          key: "refund/current/trial-1",
          status: { from: "passed", to: "failed" },
          durationMsDelta: 5,
          scores: [{ name: "helpful", from: 0.9, to: 0.4, delta: -0.5 }],
        },
        {
          key: "refund/current/trial-2",
          status: { from: "passed", to: "passed" },
          durationMsDelta: -2,
          scores: [{ name: "helpful", from: 0.8, to: 0.8, delta: 0 }],
        },
      ],
    });
  });
});

function run(runId: string, cells: EvalRunRecord["cells"]): EvalRunRecord {
  return {
    schemaVersion: 3,
    runId,
    evalId: "support",
    sourceKey: { relativeFile: "support.eval.ts", export: "default" },
    definitionFingerprint: "definition-v1",
    status: "complete",
    passed: true,
    startedAt: 1,
    endedAt: 2,
    selection: {},
    cells,
  };
}

function cell(
  trial: number,
  status: string,
  durationMs: number,
  value: number,
): EvalRunRecord["cells"][number] {
  return {
    caseId: "refund",
    variant: "current",
    trial,
    status,
    task: {
      status: "reused",
      reason: "exact_evidence",
      evidenceRef: `task-evidence-${trial}`,
    },
    metrics: { durationMs },
    scores: [
      {
        status: "reused",
        reason: "managed_external_reused",
        name: "helpful",
        value,
      },
    ],
  };
}
