import type { EvalRun } from "../../src/eval/internal/types";

export function runFixture(options: {
  readonly score: number;
  readonly taskFingerprint?: string;
  readonly definitionFingerprint?: string;
  readonly includeCandidate?: boolean;
}): EvalRun {
  const current = {
    name: "current",
    fingerprint: options.taskFingerprint ?? "model-a",
    overrideKeys: [],
    blocking: true,
  };
  const variants = options.includeCandidate
    ? [
        current,
        {
          name: "candidate",
          fingerprint: "candidate-model",
          overrideKeys: ["model"],
          blocking: false,
        },
      ]
    : [current];
  return {
    schemaVersion: 3,
    runId: "run-1",
    evalId: "support",
    sourceKey: { relativeFile: "evals/support.eval.ts", export: "default" },
    startedAt: 0,
    endedAt: 25,
    definitionFingerprint: options.definitionFingerprint ?? "definition-v1",
    selection: {
      cases: ["refund"],
      variants: variants.map((variant) => variant.name),
      trials: 1,
    },
    costControl: "not_required",
    blockingVariants: ["current"],
    cells: [
      {
        caseId: "refund",
        variant: "current",
        trial: 0,
        status: "passed",
        task: { status: "executed", reason: "no_exact_evidence" },
        scores: [
          {
            status: "computed",
            reason: "managed_external_executed",
            name: "helpful",
            contractFingerprint: "helpful-v1",
            value: options.score,
            work: {
              status: "executed",
              reason: "no_exact_evidence",
              reservation: "consumed",
            },
          },
        ],
        assertions: { ran: 0, notEvaluated: 0, outcomes: [] },
        input: { question: "private question" },
        output: "private answer",
        metrics: { durationMs: 25 },
        runIds: ["task-run-1"],
        capturedSignals: [],
      },
    ],
    variants,
    aggregates: {
      current: {
        cells: 1,
        passed: 1,
        failed: 0,
        errored: 0,
        skipped: 0,
        passRate: 1,
        scores: { helpful: { mean: options.score, sem: 0, n: 1 } },
        trialConsistency: 1,
        latencyMs: 25,
      },
    },
    gates: { passed: true, blockingPassed: true, results: [] },
    cost: {
      reservedMaximumUsd: 0,
      unknownActionCount: 0,
      task: {},
      judge: {},
    },
    provenance: { task: "managed", host: "injected", evidenceStore: "none" },
    status: "complete",
    passed: true,
  };
}

