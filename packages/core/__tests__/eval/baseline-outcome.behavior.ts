import { describe, expect, it } from "vitest";

import {
  buildEvalBaseline,
  compareEvalRunToBaseline,
} from "../../src/eval/internal/baseline";
import type { EvalRunV4 } from "../../src/eval/internal/run-types";
import { runFixture } from "./baseline-test-harness";

const promotion = {
  promotedAt: 1_000,
  toolVersion: "0.5.0",
};

/** Register Baseline promotion and comparison behavior for terminal outcomes. */
export function baselineOutcomeBehavior(): void {
  describe("terminal outcome coverage", () => {
    it("promotes complete timed-out trials without fabricated metric values", () => {
      const run = mixedOutcomeRun();
      expect(run.aggregates.current).toMatchObject({
        cells: 3,
        passed: 1,
        failed: 1,
        timedOut: 1,
        passRate: 1 / 3,
      });
      const baseline = buildEvalBaseline(run, {
        ...promotion,
        baselineId: "baseline-outcomes",
      });

      expect(baseline).toMatchObject({
        schemaVersion: 3,
        baselineFingerprintEpoch: 5,
        coverage: [
          {
            caseId: "refund",
            trials: [0, 1, 2],
            outcomes: [
              { trial: 0, status: "passed" },
              { trial: 1, status: "failed" },
              { trial: 2, status: "timed_out" },
            ],
            metrics: {
              helpful: {
                values: [
                  { trial: 0, value: 0.8 },
                  { trial: 1, value: 0.4 },
                  { trial: 2, value: null },
                ],
              },
            },
          },
        ],
      });
    });

    it("uses the admitted scorer catalog when every trial times out", () => {
      const withScorer = buildEvalBaseline(
        allTimedOutRun([
          { name: "helpful", contractFingerprint: "helpful-v1" },
        ]),
        { ...promotion, baselineId: "baseline-all-timeout" },
      );
      const withoutScorers = buildEvalBaseline(allTimedOutRun([]), {
        ...promotion,
        baselineId: "baseline-no-scorers",
      });

      expect(withScorer.coverage[0]?.metrics).toEqual({
        helpful: {
          contractFingerprint: "helpful-v1",
          aggregation: "arithmetic_mean_non_null_v1",
          values: [
            { trial: 0, value: null },
            { trial: 1, value: null },
          ],
        },
      });
      expect(withoutScorers.coverage[0]?.metrics).toEqual({});
    });

    it("continues to reject incomplete and generic errored Runs", () => {
      const complete = runFixture({ score: 0.8 });
      const errored = {
        ...complete,
        status: "incomplete",
        passed: false,
        reasons: ["task_error"],
        cells: [
          {
            ...complete.cells[0]!,
            status: "errored",
            task: { status: "errored", reason: "task_error" },
          },
        ],
      } as const;

      expect(() =>
        buildEvalBaseline(errored, {
          ...promotion,
          baselineId: "baseline-error",
        }),
      ).toThrow(/only a complete Eval run/i);
    });

    it("compares matching outcomes before ordinary metric deltas", () => {
      const run = mixedOutcomeRun();
      const baseline = buildEvalBaseline(run, {
        ...promotion,
        baselineId: "baseline-matching",
      });

      expect(compareEvalRunToBaseline(run, baseline)).toMatchObject({
        cases: [
          {
            caseId: "refund",
            status: "compatible",
            metrics: [
              {
                name: "helpful",
                status: "compatible",
                baseline: expect.closeTo(0.6),
                candidate: expect.closeTo(0.6),
                delta: 0,
              },
            ],
          },
        ],
      });
    });

    it("makes divergent aligned outcomes incompatible without metrics", () => {
      const run = mixedOutcomeRun();
      const baseline = buildEvalBaseline(run, {
        ...promotion,
        baselineId: "baseline-divergent",
      });
      const candidate = {
        ...run,
        cells: run.cells.map((cell) =>
          cell.trial === 1 ? { ...cell, status: "passed" as const } : cell,
        ),
      } satisfies EvalRunV4;

      expect(compareEvalRunToBaseline(candidate, baseline).cases).toEqual([
        {
          caseId: "refund",
          status: "incompatible",
          reason: "trial_outcomes_changed",
          metrics: [],
        },
      ]);
    });

    it("makes matching null-only metrics unavailable", () => {
      const run = allTimedOutRun([
        { name: "helpful", contractFingerprint: "helpful-v1" },
      ]);
      const baseline = buildEvalBaseline(run, {
        ...promotion,
        baselineId: "baseline-null",
      });

      expect(compareEvalRunToBaseline(run, baseline).cases).toEqual([
        {
          caseId: "refund",
          status: "missing",
          metrics: [
            {
              name: "helpful",
              status: "missing",
              reason: "metric_value_unavailable",
            },
          ],
        },
      ]);
    });
  });
}

function mixedOutcomeRun(): EvalRunV4 {
  const source = runFixture({ score: 0.8 });
  const first = source.cells[0]!;
  const { output: _output, ...withoutOutput } = first;
  const scorerContracts = [
    { name: "helpful", contractFingerprint: "helpful-v1" },
  ] as const;
  return {
    ...source,
    schemaVersion: 4,
    selection: {
      ...source.selection,
      trials: 3,
      caseTrials: { refund: 3 },
    },
    cells: [
      { ...first, scorerContracts },
      {
        ...first,
        trial: 1,
        status: "failed",
        scorerContracts,
        scores: [{ ...first.scores[0]!, value: 0.4 }],
      },
      {
        ...withoutOutput,
        trial: 2,
        status: "timed_out",
        task: { status: "timed_out" },
        timeout: { budget: "total", limitMs: 1_000 },
        scorerContracts,
        scores: [],
        assertions: { ran: 0, notEvaluated: 0, outcomes: [] },
      },
    ],
    aggregates: {
      current: {
        ...source.aggregates.current!,
        cells: 3,
        passed: 1,
        failed: 1,
        timedOut: 1,
        passRate: 1 / 3,
      },
    },
    gates: { passed: false, blockingPassed: false, results: [] },
    passed: false,
  };
}

function allTimedOutRun(
  scorerContracts: readonly {
    readonly name: string;
    readonly contractFingerprint: string;
  }[],
): EvalRunV4 {
  const source = runFixture({ score: 0.8 });
  const { output: _output, ...cell } = source.cells[0]!;
  return {
    ...source,
    schemaVersion: 4,
    selection: {
      ...source.selection,
      trials: 2,
      caseTrials: { refund: 2 },
    },
    cells: [0, 1].map((trial) => ({
      ...cell,
      trial,
      status: "timed_out" as const,
      task: { status: "timed_out" as const },
      timeout: { budget: "total" as const, limitMs: 1_000 },
      scorerContracts,
      scores: [],
      assertions: { ran: 0, notEvaluated: 0, outcomes: [] },
    })),
    aggregates: {
      current: {
        ...source.aggregates.current!,
        cells: 2,
        passed: 0,
        failed: 0,
        timedOut: 2,
        passRate: 0,
      },
    },
    gates: { passed: false, blockingPassed: false, results: [] },
    passed: false,
  };
}
