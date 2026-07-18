import { describe, expect, it } from "vitest";
import type { EvalRun } from "@use-crux/core/eval/internal/runner";
import { projectEvalRunForCli } from "./cli-run-projection";

describe("Eval CLI run projection", () => {
  it("omits persisted payloads and bounds authored diagnostics", () => {
    const large = "x".repeat(100_000);
    const run = {
      runId: "evalrun_1",
      status: "incomplete",
      passed: false,
      cost: { actualUsd: 0.1 },
      cells: [
        {
          caseId: "large",
          variant: "current",
          trial: 0,
          status: "errored",
          task: { status: "errored", reason: "task_error" },
          input: large,
          output: large,
          expected: large,
          scores: [],
          assertions: {
            ran: 1,
            notEvaluated: 0,
            outcomes: [{ status: "failed", message: large }],
          },
          metrics: { durationMs: 1 },
          runIds: ["run_1"],
          capturedSignals: [],
          error: { phase: "execute", message: large },
        },
      ],
    } as unknown as EvalRun;

    const encoded = JSON.stringify(projectEvalRunForCli(run));

    expect(encoded.length).toBeLessThan(16_000);
    expect(encoded).not.toContain(`"input"`);
    expect(encoded).not.toContain(`"output"`);
    expect(encoded).not.toContain(`"expected"`);
    expect(encoded).toContain("…[truncated]");
  });
});
