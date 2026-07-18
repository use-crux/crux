import { describe, expect, it, vi } from "vitest";

import { evaluate } from "../../src/eval/evaluate";
import { executeEvalPlan } from "../../src/eval/internal/executor";
import { planEval } from "../../src/eval/internal/planner";
import type { EvalExecutionPorts } from "../../src/eval/internal/ports";
import {
  evalValue,
  memoryEvidenceStore,
  planningPorts,
  task,
  taskResult,
} from "./reuse-test-harness";

const sourceKey = {
  relativeFile: "support.eval.ts",
  export: "default" as const,
};

describe("Eval evidence freshness", () => {
  it("keeps a fresh execution attempt unique when evidence identity is unavailable", async () => {
    const evidenceStore = memoryEvidenceStore();
    const execute = vi.fn(async () => taskResult("fresh"));
    const plan = await planEval(
      evalValue(),
      { sourceKey, fresh: true },
      {
        ...planningPorts(evidenceStore),
        taskIdentity: {
          describe: async () => ({
            reusable: false as const,
            reason: "task_binding_untracked" as const,
          }),
        },
      },
    );

    await executeEvalPlan(plan, {
      taskHost: { execute },
      clock: { now: () => 1 },
      ids: { next: () => "fresh-run-1" },
      runStore: { write: async () => undefined },
      evidenceStore,
    });

    expect(plan.cells[0]?.action).toMatchObject({
      kind: "execute",
      reason: "fresh_requested",
    });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ executionAttemptId: "fresh-run-1" }),
    );
  });

  it("bypasses exact evidence reads when fresh and replaces it after success", async () => {
    const evidenceStore = memoryEvidenceStore();
    const read = vi.spyOn(evidenceStore, "read");
    const hostExecute = vi
      .fn()
      .mockResolvedValueOnce(taskResult("first"))
      .mockResolvedValueOnce(taskResult("fresh"));
    const executionPorts: EvalExecutionPorts = {
      taskHost: { execute: hostExecute },
      clock: { now: () => 1 },
      ids: { next: () => "eval-run-1" },
      runStore: { write: async () => undefined },
      evidenceStore,
    };

    await executeEvalPlan(
      await planEval(evalValue(), { sourceKey }, planningPorts(evidenceStore)),
      executionPorts,
    );
    read.mockClear();
    const freshPlan = await planEval(
      evalValue(),
      { sourceKey, fresh: true },
      planningPorts(evidenceStore),
    );
    const freshRun = await executeEvalPlan(freshPlan, executionPorts);

    expect(read).not.toHaveBeenCalled();
    expect(freshPlan.cells[0]?.action).toMatchObject({
      kind: "execute",
      reason: "fresh_requested",
    });
    expect(freshPlan.cells[0]?.action).not.toHaveProperty("freshnessSource");
    expect(freshRun.cells[0]).toMatchObject({
      output: "fresh",
      task: { status: "executed", reason: "fresh_requested" },
    });
    expect(hostExecute).toHaveBeenCalledTimes(2);
    expect(evidenceStore.entries.size).toBe(1);
  });

  it("forces fresh task evidence for a latency Gate but not an ordinary Gate", async () => {
    const evidenceStore = memoryEvidenceStore();
    const executionPorts: EvalExecutionPorts = {
      taskHost: { execute: async () => taskResult() },
      clock: { now: () => 1 },
      ids: { next: () => "eval-run-1" },
      runStore: { write: async () => undefined },
      evidenceStore,
    };
    await executeEvalPlan(
      await planEval(evalValue(), { sourceKey }, planningPorts(evidenceStore)),
      executionPorts,
    );
    const withGate = (gates: Parameters<typeof evaluate>[0]["gates"]) =>
      evaluate({
        id: "support",
        task,
        cases: [{ id: "refund", input: { question: "yes" } }],
        gates,
      });

    const ordinary = await planEval(
      withGate({ passRate: { min: 1 } }),
      { sourceKey },
      planningPorts(evidenceStore),
    );
    const performance = await planEval(
      withGate({ latency: { meanMs: 10 } }),
      { sourceKey },
      planningPorts(evidenceStore),
    );

    expect(ordinary.cells[0]?.action).toMatchObject({
      kind: "reuse",
      reason: "exact_evidence",
    });
    expect(await executeEvalPlan(ordinary, executionPorts)).toMatchObject({
      passed: true,
      gates: {
        results: [
          {
            gate: "passRate.min",
            threshold: 1,
            actual: 1,
            passed: true,
          },
        ],
      },
    });
    expect(performance.cells[0]?.action).toMatchObject({
      kind: "execute",
      reason: "performance_freshness",
      freshnessSource: "latency_gate",
    });
    expect(await executeEvalPlan(performance, executionPorts)).toMatchObject({
      status: "complete",
      passed: false,
      gates: {
        passed: false,
        results: [
          {
            gate: "latency.meanMs",
            variantName: "current",
            threshold: 10,
            actual: 20,
            passed: false,
          },
        ],
      },
    });
  });

  it("scopes a fresh Case callback to that Case and records its source", async () => {
    const evidenceStore = memoryEvidenceStore();
    const executionPorts: EvalExecutionPorts = {
      taskHost: { execute: async () => taskResult() },
      clock: { now: () => 1 },
      ids: { next: () => "eval-run-1" },
      runStore: { write: async () => undefined },
      evidenceStore,
    };
    const base = evaluate({
      id: "support",
      task,
      cases: [
        { id: "ordinary", input: { question: "One" } },
        { id: "timed", input: { question: "Two" } },
      ],
    });
    await executeEvalPlan(
      await planEval(base, { sourceKey }, planningPorts(evidenceStore)),
      executionPorts,
    );
    const planned = await planEval(
      evaluate({
        id: "support",
        task,
        cases: [
          { id: "ordinary", input: { question: "One" } },
          {
            id: "timed",
            input: { question: "Two" },
            expect: { fresh: true, check: () => undefined },
          },
        ],
      }),
      { sourceKey },
      planningPorts(evidenceStore),
    );

    expect(planned.cells).toMatchObject([
      { caseId: "ordinary", action: { kind: "reuse" } },
      {
        caseId: "timed",
        action: {
          kind: "execute",
          reason: "performance_freshness",
          freshnessSource: "case_expect",
        },
      },
    ]);
  });

  it("records every declared callback freshness source", async () => {
    const evidenceStore = memoryEvidenceStore();
    const definitions = [
      [
        "eval_expect",
        evaluate({
          id: "support",
          task,
          cases: [{ id: "refund", input: { question: "Refund?" } }],
          expect: { fresh: true, check: () => undefined },
        }),
      ],
      [
        "eval_after_scores",
        evaluate({
          id: "support",
          task,
          cases: [{ id: "refund", input: { question: "Refund?" } }],
          afterScores: { fresh: true, check: () => undefined },
        }),
      ],
      [
        "case_after_scores",
        evaluate({
          id: "support",
          task,
          cases: [
            {
              id: "refund",
              input: { question: "Refund?" },
              afterScores: { fresh: true, check: () => undefined },
            },
          ],
        }),
      ],
    ] as const;

    for (const [source, definition] of definitions) {
      const plan = await planEval(
        definition,
        { sourceKey },
        planningPorts(evidenceStore),
      );
      expect(plan.cells[0]?.action).toMatchObject({
        kind: "execute",
        reason: "performance_freshness",
        freshnessSource: source,
      });
    }
  });
});
