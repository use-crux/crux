import { describe, expect, it } from "vitest";

import {
  buildEvalBaseline,
  compareEvalDefinitionToBaseline,
  compareEvalRunToBaseline,
} from "../../src/eval/internal/baseline";
import { evaluate } from "../../src/eval";
import { evaluateBlockingGates } from "../../src/eval/internal/gates";
import { executeEvalPlan } from "../../src/eval/internal/executor";
import { planEval } from "../../src/eval/internal/planner";
import type { EvalRun } from "../../src/eval/internal/types";
import { runFixture } from "./baseline-test-harness";
import {
  evalValue,
  nonBillablePlanningPorts,
  taskResult,
} from "./reuse-test-harness";
import { scorers } from "../../src/eval/internal/scorers/types";
import type { Scorer } from "../../src/eval/internal/scorers/types";
import { UNVERSIONED_LOCAL_SCORER_CONTRACT } from "../../src/eval/internal/scorers/runtime";

const promotion = {
  baselineId: "baseline-1",
  promotedAt: 1_000,
  toolVersion: "0.5.0",
};

describe("granular Eval Baseline compatibility", () => {
  async function runWithAssessment(input: {
    readonly scorer?: Scorer<unknown, unknown, unknown>;
    readonly recorded?: number;
  }) {
    const definition = evaluate({
      id: "assessment-contract",
      task: async (value: string) => value,
      cases: [{ id: "case", input: "answer" }],
      ...(input.scorer !== undefined ? { scorers: [input.scorer] } : {}),
      ...(input.recorded !== undefined
        ? {
            expect: ({
              recordScore,
            }: {
              recordScore(name: string, score: number): void;
            }) => {
              recordScore("authored", input.recorded!);
            },
          }
        : {}),
    });
    const plan = await planEval(
      definition,
      {
        sourceKey: { relativeFile: "assessment.eval.ts", export: "default" },
      },
      nonBillablePlanningPorts(),
    );
    return executeEvalPlan(plan, {
      taskHost: {
        execute: async () => ({
          output: "answer",
          capturedSignals: [],
          runIds: ["task-run"],
          metrics: { durationMs: 1 },
          observedIdentity: { reusable: false, reason: "identity_unavailable" },
        }),
      },
      clock: { now: () => 1 },
      ids: { next: () => "assessment-run" },
      runStore: { write: async () => undefined },
    });
  }

  function localScorer(score: number) {
    return Object.assign(() => ({ name: "authored", score }), {
      scorerName: "authored" as const,
      costClass: "code" as const,
    });
  }

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
            {
              ...source.cells[0]!.scores[0]!,
              contractFingerprint: "helpful-v2",
            },
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

  it("never claims an unversioned authored code scorer is Baseline-compatible", async () => {
    const baseline = buildEvalBaseline(
      await runWithAssessment({ scorer: localScorer(1) }),
      promotion,
    );
    const comparison = compareEvalRunToBaseline(
      await runWithAssessment({ scorer: localScorer(0.5) }),
      baseline,
    );

    expect(comparison.cases[0]?.metrics).toEqual([
      {
        name: "authored",
        status: "incompatible",
        reason: "metric_contract_changed",
      },
    ]);
  });

  it("never claims recordScore callback logic is Baseline-compatible", async () => {
    const baseline = buildEvalBaseline(
      await runWithAssessment({ recorded: 1 }),
      promotion,
    );
    const comparison = compareEvalRunToBaseline(
      await runWithAssessment({ recorded: 0.5 }),
      baseline,
    );

    expect(comparison.cases[0]?.metrics).toEqual([
      {
        name: "authored",
        status: "incompatible",
        reason: "metric_contract_changed",
      },
    ]);
  });

  it("keeps an explicitly versioned built-in scorer Baseline-compatible", async () => {
    const baseline = buildEvalBaseline(
      await runWithAssessment({ scorer: scorers.exact() }),
      promotion,
    );
    const comparison = compareEvalRunToBaseline(
      await runWithAssessment({ scorer: scorers.exact() }),
      baseline,
    );

    expect(comparison.cases[0]?.metrics[0]).toMatchObject({
      name: "exact",
      status: "compatible",
    });
  });

  it("makes missing or incompatible relative-Gate evidence non-green", () => {
    const run = runFixture({ score: 0.7 });
    const gates = { scores: { helpful: { minDeltaVsBaseline: -0.1 } } };
    expect(
      evaluateBlockingGates(
        run.cells,
        ["current"],
        gates,
        undefined,
        "support",
      ),
    ).toMatchObject({
      passed: false,
      blockingPassed: false,
      results: [
        {
          gate: "scores.helpful.minDeltaVsBaseline",
          passed: false,
          evidence: "incomplete",
          reason: "baseline_missing",
          remediation: "crux eval baseline set <run-id>",
        },
      ],
    });
  });

  it("records missing relative-Gate evidence as an incomplete run", async () => {
    const planned = await planEval(
      evalValue(),
      {
        sourceKey: { relativeFile: "support.eval.ts", export: "default" },
      },
      nonBillablePlanningPorts(),
    );
    const run = await executeEvalPlan(
      {
        ...planned,
        gates: { scores: { helpful: { minDeltaVsBaseline: -0.1 } } },
      },
      {
        taskHost: { execute: async () => taskResult() },
        clock: { now: () => 1 },
        ids: { next: () => "run-without-baseline" },
        runStore: { write: async () => undefined },
      },
    );

    expect(run).toMatchObject({
      status: "incomplete",
      passed: false,
      reasons: ["baseline_missing"],
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

  it("compares a Baseline to the discovered definition without executing checks", () => {
    const scorer = Object.assign(() => ({ name: "helpful", score: 1 }), {
      scorerName: "helpful" as const,
      costClass: "code" as const,
    });
    const current = evaluate({
      id: "support",
      task: (input: { question: string }) => input.question,
      cases: [{ id: "refund", input: { question: "private question" } }],
      scorers: [scorer],
    });
    const baseline = buildEvalBaseline(
      {
        ...runFixture({ score: 0.8 }),
        cells: [
          {
            ...runFixture({ score: 0.8 }).cells[0]!,
            scores: [
              {
                ...runFixture({ score: 0.8 }).cells[0]!.scores[0]!,
                contractFingerprint: UNVERSIONED_LOCAL_SCORER_CONTRACT,
              },
            ],
          },
        ],
      },
      promotion,
    );

    expect(
      compareEvalDefinitionToBaseline(current, "definition-v2", baseline),
    ).toMatchObject({
      status: "unknown",
      reason: "scorer_contract_unprojectable",
      currentDefinitionFingerprint: "definition-v2",
      variant: { name: "current", status: "compatible" },
      cases: [
        {
          caseId: "refund",
          status: "unknown",
          reason: "scorer_contract_unprojectable",
          metrics: [{ name: "helpful", status: "unknown" }],
        },
      ],
    });
  });

  it("never calls a dynamic scorer factory to claim Baseline compatibility", () => {
    let calls = 0;
    const current = evaluate({
      id: "support",
      task: (input: { question: string }) => input.question,
      cases: [{ id: "refund", input: { question: "private question" } }],
      scorers: () => {
        calls++;
        return [];
      },
    });
    const baseline = buildEvalBaseline(runFixture({ score: 0.8 }), promotion);
    expect(
      compareEvalDefinitionToBaseline(current, "definition-v2", baseline),
    ).toMatchObject({
      status: "unknown",
      reason: "scorer_contract_unprojectable",
      cases: [
        {
          metrics: [
            {
              name: "helpful",
              status: "unknown",
              reason: "scorer_contract_unprojectable",
            },
          ],
        },
      ],
    });
    expect(calls).toBe(0);
  });

  it.each([
    ["function", () => "dynamic"],
    ["symbol", Symbol("dynamic")],
    ["bigint", 1n],
  ])(
    "marks a Case with an unprojectable %s contract unknown without aborting catalog comparison",
    (_kind, input) => {
      const current = evaluate({
        id: "support",
        task: (value: unknown) => value,
        cases: [{ id: "refund", input }],
      });
      const baseline = buildEvalBaseline(runFixture({ score: 0.8 }), promotion);

      expect(
        compareEvalDefinitionToBaseline(current, "definition-v2", baseline),
      ).toMatchObject({
        status: "unknown",
        reason: "case_contract_unprojectable",
        cases: [
          {
            caseId: "refund",
            status: "unknown",
            reason: "case_contract_unprojectable",
            metrics: [],
          },
        ],
      });
    },
  );

  it("marks an unidentifiable implicit Case unknown without masking structural errors", () => {
    const baseline = buildEvalBaseline(runFixture({ score: 0.8 }), promotion);
    const unidentifiable = evaluate({
      id: "support",
      task: (value: unknown) => value,
      cases: [{ input: Symbol("dynamic") }],
    });

    expect(
      compareEvalDefinitionToBaseline(
        unidentifiable,
        "definition-v2",
        baseline,
      ),
    ).toMatchObject({
      status: "unknown",
      reason: "case_contract_unprojectable",
      cases: [
        {
          caseId: "refund",
          status: "unknown",
          reason: "case_contract_unprojectable",
        },
      ],
    });

    const invalidTrials = evaluate({
      id: "support",
      task: (value: unknown) => value,
      cases: [{ id: "refund", input: Symbol("dynamic"), trials: 0 }],
    });
    expect(() =>
      compareEvalDefinitionToBaseline(
        invalidTrials,
        "definition-v2",
        baseline,
      ),
    ).toThrow(/trials must be a positive integer/i);
  });
});
