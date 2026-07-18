import { describe, expect, it } from "vitest";

import { evaluate } from "../../src/eval/evaluate";
import { executeEvalPlan } from "../../src/eval/internal/executor";
import { planEval } from "../../src/eval/internal/planner";
import { readScorerEvidenceEntry } from "../../src/eval/internal/scorer-evidence";
import { scorers } from "../../src/eval/internal/scorers/types";
import {
  createManagedScorerHarness,
  managedScorerDefinition,
  managedScorerSource,
  task,
  taskIdentity,
} from "./managed-scorer-test-harness";

function twoJudgeDefinition(firstRubric: string) {
  return evaluate({
    id: "support",
    task,
    cases: [{ id: "refund", input: { question: "yes" }, expected: "yes" }],
    scorers: [
      scorers.judge({ name: "helpful", rubric: firstRubric }),
      scorers.judge({ name: "grounded", rubric: "Is it grounded?" }),
    ],
  });
}

describe("managed external scorer evidence", () => {
  it("treats scorer evidence from an older cache epoch as a miss", () => {
    expect(
      readScorerEvidenceEntry(
        {
          schemaVersion: 1,
          scorerResultCacheEpoch: 0,
          status: "complete",
          key: "score-key",
          fingerprint: "score-key",
          score: { name: "helpful", score: 1 },
        },
        "score-key",
      ),
    ).toBeUndefined();
  });

  it("admits before task execution and reuses the exact judge result", async () => {
    const harness = createManagedScorerHarness();
    const firstPlan = await planEval(
      managedScorerDefinition("Is it helpful?"),
      managedScorerSource,
      harness.planning,
    );
    expect(firstPlan.scorerActions[0]).toMatchObject({
      kind: "after_task_output",
      admission: "admitted",
      externalKind: "model",
      reason: "output_dependency",
    });
    const first = await executeEvalPlan(firstPlan, harness.execution());
    const secondPlan = await planEval(
      managedScorerDefinition("Is it helpful?"),
      managedScorerSource,
      harness.planning,
    );
    expect(secondPlan.scorerActions[0]).toMatchObject({
      kind: "reuse",
      reason: "exact_evidence",
    });
    const second = await executeEvalPlan(secondPlan, harness.execution());

    expect(harness.taskExecute).toHaveBeenCalledOnce();
    expect(harness.scorerExecute).toHaveBeenCalledOnce();
    expect(first.cells[0].scores[0]).toMatchObject({
      reason: "managed_external_executed",
      work: { status: "executed" },
    });
    expect(second.cells[0].scores[0]).toMatchObject({
      status: "reused",
      reason: "managed_external_reused",
      work: { status: "reused", reason: "exact_evidence" },
    });
  });

  it("changes only the judge work when its rubric changes", async () => {
    const harness = createManagedScorerHarness();
    await executeEvalPlan(
      await planEval(
        managedScorerDefinition("First rubric"),
        managedScorerSource,
        harness.planning,
      ),
      harness.execution(),
    );
    const changedPlan = await planEval(
      managedScorerDefinition("Changed rubric"),
      managedScorerSource,
      harness.planning,
    );
    expect(changedPlan.cells[0].action.kind).toBe("reuse");
    expect(changedPlan.scorerActions[0]).toMatchObject({
      kind: "execute",
      reason: "no_exact_evidence",
    });
    await executeEvalPlan(changedPlan, harness.execution());

    expect(harness.taskExecute).toHaveBeenCalledOnce();
    expect(harness.scorerExecute).toHaveBeenCalledTimes(2);
  });

  it("changes only judge work when its explicit model changes", async () => {
    const harness = createManagedScorerHarness();
    const definition = (model: string) =>
      evaluate({
        id: "support",
        task,
        cases: [{ id: "refund", input: { question: "yes" }, expected: "yes" }],
        scorers: [
          scorers.judge({
            name: "helpful",
            rubric: "Is it helpful?",
            model,
          }),
        ],
      });
    await executeEvalPlan(
      await planEval(
        definition("judge-v1"),
        managedScorerSource,
        harness.planning,
      ),
      harness.execution(),
    );
    const changed = await planEval(
      definition("judge-v2"),
      managedScorerSource,
      harness.planning,
    );

    expect(changed.cells[0]?.action.kind).toBe("reuse");
    expect(changed.scorerActions[0]).toMatchObject({
      kind: "execute",
      reason: "no_exact_evidence",
    });
  });

  it("keeps an unchanged managed score reusable when another contract changes", async () => {
    const harness = createManagedScorerHarness();
    await executeEvalPlan(
      await planEval(
        twoJudgeDefinition("First rubric"),
        managedScorerSource,
        harness.planning,
      ),
      harness.execution(),
    );
    const changedPlan = await planEval(
      twoJudgeDefinition("Changed rubric"),
      managedScorerSource,
      harness.planning,
    );

    expect(changedPlan.scorerActions).toMatchObject([
      { scorerName: "helpful", kind: "execute", reason: "no_exact_evidence" },
      { scorerName: "grounded", kind: "reuse", reason: "exact_evidence" },
    ]);
    await executeEvalPlan(changedPlan, harness.execution());
    expect(harness.taskExecute).toHaveBeenCalledOnce();
    expect(harness.scorerExecute).toHaveBeenCalledTimes(3);
  });

  it("marks the admitted scorer dependency failed without calling its host", async () => {
    const harness = createManagedScorerHarness();
    const plan = await planEval(
      managedScorerDefinition("Is it helpful?"),
      managedScorerSource,
      harness.planning,
    );
    const run = await executeEvalPlan(plan, {
      ...harness.execution(),
      taskHost: {
        execute: async () => {
          throw new Error("provider unavailable");
        },
      },
    });

    expect(harness.scorerExecute).not.toHaveBeenCalled();
    expect(run.cells[0]).toMatchObject({
      status: "errored",
      scores: [
        {
          status: "missing",
          reason: "dependency_failed",
          name: "helpful",
        },
      ],
    });
  });

  it("separates actual task and judge spend in score evidence and run totals", async () => {
    const harness = createManagedScorerHarness();
    const plan = await planEval(
      managedScorerDefinition("Is it helpful?"),
      managedScorerSource,
      harness.planning,
    );
    const run = await executeEvalPlan(plan, {
      ...harness.execution(),
      taskHost: {
        execute: async () => ({
          output: "yes",
          response: {
            content: [],
            text: "yes",
            steps: [],
            finalStep: {
              content: [],
              text: "yes",
              finishReason: "stop",
              responseId: "response-cost",
              modelId: "task-model",
              warnings: [],
            },
            messages: [],
            warnings: [],
          },
          capturedSignals: [],
          runIds: ["task-run-cost"],
          metrics: { durationMs: 2, costUsd: 0.02 },
          observedIdentity: taskIdentity,
        }),
      },
      externalScorerHost: {
        execute: async () =>
          ({
            score: { name: "helpful", score: 1 },
            usage: {
              inputTokens: 10,
              outputTokens: 2,
              totalTokens: 12,
              inputTokenDetails: {},
              outputTokenDetails: {},
            },
            actualUsd: 0.03,
          }) as never,
      },
    });

    expect(run.cells[0]?.scores[0]).toMatchObject({
      status: "computed",
      metrics: {
        actualUsd: 0.03,
        usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
      },
    });
    expect(run.cost).toEqual({
      actualUsd: 0.05,
      reservedMaximumUsd: 0,
      unknownActionCount: 0,
      task: { actualUsd: 0.02 },
      judge: { actualUsd: 0.03 },
    });
  });
});
