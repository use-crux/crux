import { describe, expect, it } from "vitest";

import { currentArmStatus } from "./catalog-status";
import { parseEvalRun } from "./parse-run";

describe("Eval Run V4 parsing", () => {
  it("reads current timed-out runs and retained V3 runs without treating timeout as incomplete", () => {
    const current = parseEvalRun(runFixture(4));

    expect(current).toMatchObject({
      schemaVersion: 4,
      cells: [
        {
          status: "timed_out",
          task: { status: "timed_out" },
          timeout: { budget: "chunk", limitMs: 750 },
          scorerContracts: [],
        },
      ],
      aggregates: { current: { timedOut: 1 } },
    });
    expect(currentArmStatus(current, "definition-v1")).toBe("failed");
    expect(parseEvalRun(runFixture(3))).toMatchObject({
      schemaVersion: 3,
      cells: [{ status: "failed" }],
    });
  });
});

function runFixture(schemaVersion: 3 | 4) {
  const timedOut = schemaVersion === 4;
  return {
    schemaVersion,
    runId: `run-v${schemaVersion}`,
    evalId: "support",
    sourceKey: { relativeFile: "support.eval.ts", export: "default" },
    definitionFingerprint: "definition-v1",
    status: "complete",
    passed: false,
    startedAt: 1,
    endedAt: 2,
    selection: {
      cases: ["refund"],
      variants: ["current"],
      trials: 1,
      caseTrials: { refund: 1 },
    },
    costControl: "not_required",
    blockingVariants: ["current"],
    cells: [
      {
        caseId: "refund",
        variant: "current",
        trial: 0,
        status: timedOut ? "timed_out" : "failed",
        task: timedOut
          ? { status: "timed_out" }
          : { status: "executed", reason: "no_exact_evidence" },
        scores: [],
        assertions: { ran: 0, notEvaluated: 0, outcomes: [] },
        input: { question: "Can I get a refund?" },
        metrics: { durationMs: 1 },
        runIds: [],
        capturedSignals: [],
        ...(timedOut
          ? {
              timeout: { budget: "chunk", limitMs: 750 },
              scorerContracts: [],
            }
          : {}),
      },
    ],
    variants: [
      {
        name: "current",
        fingerprint: "variant-v1",
        overrideKeys: [],
        blocking: true,
      },
    ],
    aggregates: {
      current: {
        cells: 1,
        passed: 0,
        failed: timedOut ? 0 : 1,
        errored: 0,
        skipped: 0,
        ...(timedOut ? { timedOut: 1 } : {}),
        passRate: 0,
        scores: {},
        trialConsistency: 1,
        latencyMs: 1,
      },
    },
    gates: { passed: false, blockingPassed: false, results: [] },
    cost: {
      reservedMaximumUsd: 0,
      unknownActionCount: 0,
      task: {},
      judge: {},
    },
    provenance: { task: "managed", host: "injected", evidenceStore: "none" },
  };
}
