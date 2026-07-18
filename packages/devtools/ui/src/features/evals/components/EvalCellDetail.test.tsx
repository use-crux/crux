import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EvalRunRecord } from "../types";
import { EvalCellDetail } from "./EvalCellDetail";

describe("EvalCellDetail", () => {
  it("shows the evidence needed to understand and debug one cell", () => {
    const cell: EvalRunRecord["cells"][number] = {
      caseId: "refund",
      variant: "current",
      trial: 0,
      status: "failed",
      task: {
        status: "reused",
        reason: "exact_evidence",
        evidenceRef: "task-evidence-1",
      },
      input: { question: "Can I get a refund?" },
      output: { answer: "No" },
      expected: { answer: "Yes" },
      metrics: { durationMs: 42, costUsd: 0.01 },
      runIds: ["run-generation-1"],
      capturedSignals: ["observability"],
      scores: [
        {
          status: "reused",
          reason: "managed_external_reused",
          name: "helpful",
          value: 0.4,
          label: "weak",
          rationale: "The answer is incorrect.",
          work: {
            status: "reused",
            reason: "exact_evidence",
            evidenceRef: "score-evidence-1",
            reservation: "released",
          },
        },
      ],
      assertions: {
        ran: 1,
        notEvaluated: 0,
        outcomes: [
          {
            id: "assert-1",
            status: "failed",
            matcher: "toEqual",
            message: "Expected Yes",
          },
        ],
      },
    };
    const markup = renderToStaticMarkup(
      <EvalCellDetail cell={cell} onOpenRun={() => undefined} />,
    );
    for (const value of [
      "refund / current / trial 1",
      "reused: exact_evidence",
      "42ms",
      "$0.010000",
      "helpful",
      "reused · managed_external_reused",
      "work reused: exact_evidence",
      "evidence score-evidence-1",
      "reservation released",
      "0.4",
      "The answer is incorrect.",
      "Expected Yes",
      "Can I get a refund?",
      "run-generation-1",
      "Run evidence unavailable locally",
    ]) {
      expect(markup).toContain(value);
    }
    expect(markup).not.toContain("<button");
  });

  it("links only run references proven available in Local observability", () => {
    const cell: EvalRunRecord["cells"][number] = {
      caseId: "refund",
      variant: "current",
      trial: 0,
      status: "passed",
      task: { status: "executed", reason: "no_exact_evidence" },
      runIds: ["run-available", "run-missing"],
    };
    const markup = renderToStaticMarkup(
      <EvalCellDetail
        cell={cell}
        onOpenRun={() => undefined}
        runAvailability={
          new Map([
            ["run-available", "available"],
            ["run-missing", "unavailable"],
          ])
        }
      />,
    );

    expect(markup).toContain('aria-label="Open observed run run-available"');
    expect(markup).toContain("run-missing");
    expect(markup).toContain("Run evidence unavailable locally");
    expect(markup).not.toContain("Open observed run run-missing");
  });
});
