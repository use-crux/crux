import { describe, expect, it } from "vitest";

import {
  buildEvalBaseline,
  compareEvalRunToBaseline,
} from "../../src/eval/internal/baseline";
import { evaluateBlockingGates } from "../../src/eval/internal/gates";
import type { EvalRun } from "../../src/eval/internal/types";
import { runFixture } from "./baseline-test-harness";

const promotion = {
  baselineId: "baseline-1",
  promotedAt: 1_000,
  toolVersion: "0.5.0",
};

describe("granular Eval Baseline compatibility", () => {
  it("isolates Case identity drift and added Cases", () => {
    const baseline = buildEvalBaseline(runFixture({ score: 0.8 }), promotion);
    const source = runFixture({ score: 0.7 });
    const changed = {
      ...source,
      selection: { ...source.selection, cases: ["refund", "shipping"] },
      cells: [
        { ...source.cells[0]!, input: { question: "changed" } },
        { ...source.cells[0]!, caseId: "shipping" },
      ],
    } satisfies EvalRun;

    expect(compareEvalRunToBaseline(changed, baseline)).toMatchObject({
      cases: [
        {
          caseId: "refund",
          status: "incompatible",
          reason: "case_contract_changed",
        },
      ],
      unmatchedCases: { baselineOnly: [], candidateOnly: ["shipping"] },
    });
  });

  it("isolates scorer drift and missing metric evidence", () => {
    const baseline = buildEvalBaseline(runFixture({ score: 0.8 }), promotion);
    const source = runFixture({ score: 0.7 });
    const changedContract = {
      ...source,
      cells: [
        {
          ...source.cells[0]!,
          scores: [
            { ...source.cells[0]!.scores[0]!, contractFingerprint: "helpful-v2" },
          ],
        },
      ],
    } satisfies EvalRun;
    expect(compareEvalRunToBaseline(changedContract, baseline)).toMatchObject({
      cases: [
        {
          status: "incompatible",
          metrics: [
            {
              name: "helpful",
              status: "incompatible",
              reason: "metric_contract_changed",
            },
          ],
        },
      ],
    });

    const missing = {
      ...source,
      cells: [{ ...source.cells[0]!, scores: [] }],
    } satisfies EvalRun;
    expect(compareEvalRunToBaseline(missing, baseline)).toMatchObject({
      cases: [
        {
          status: "missing",
          metrics: [
            { name: "helpful", status: "missing", reason: "metric_missing" },
          ],
        },
      ],
    });
  });

  it("makes missing or incompatible relative-Gate evidence non-green", () => {
    const run = runFixture({ score: 0.7 });
    const gates = { scores: { helpful: { minDeltaVsBaseline: -0.1 } } };
    expect(
      evaluateBlockingGates(run.cells, ["current"], gates, undefined, "support"),
    ).toMatchObject({
      passed: false,
      blockingPassed: false,
      results: [
        {
          gate: "scores.helpful.minDeltaVsBaseline",
          passed: false,
          evidence: "incomplete",
          reason: "baseline_missing",
          remediation: "crux eval baseline set support",
        },
      ],
    });
  });

  it("refuses partial arms but accepts a failing complete run with a warning", () => {
    const partial = runFixture({ score: 0.8 });
    expect(() =>
      buildEvalBaseline(
        {
          ...partial,
          selection: { ...partial.selection, cases: ["refund", "missing"] },
        },
        promotion,
      ),
    ).toThrow(/incomplete.*missing/i);

    const failed = runFixture({ score: 0.4 });
    const accepted = buildEvalBaseline(
      {
        ...failed,
        passed: false,
        cells: [{ ...failed.cells[0]!, status: "failed" }],
      },
      promotion,
    );
    expect(accepted.warnings).toEqual([
      { code: "promoted_failing_run", message: expect.any(String) },
    ]);
  });

  it("refuses filtered selections and missing trials", () => {
    const complete = runFixture({ score: 0.8 });

    expect(() =>
      buildEvalBaseline(
        {
          ...complete,
          selection: { ...complete.selection, filtered: true },
        },
        promotion,
      ),
    ).toThrow(/filtered/i);

    expect(() =>
      buildEvalBaseline(
        {
          ...complete,
          selection: {
            ...complete.selection,
            caseTrials: { refund: 2 },
            trials: 2,
          },
        },
        promotion,
      ),
    ).toThrow(/incomplete.*trial/i);
  });
});
