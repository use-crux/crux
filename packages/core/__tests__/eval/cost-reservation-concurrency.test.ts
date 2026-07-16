import { describe, expect, it, vi } from "vitest";

import { evaluate } from "../../src/eval/evaluate";
import { executeEvalPlan } from "../../src/eval/internal/executor";
import { planEval } from "../../src/eval/internal/planner";
import { createMemoryEvalReservationPort } from "../../src/eval/internal/reservation";
import {
  createManagedScorerHarness,
  managedScorerSource,
  response,
  task,
  taskIdentity,
} from "./managed-scorer-test-harness";

describe("Eval reservation concurrency", () => {
  it("allows only one concurrent executor to spend a shared hard cap", async () => {
    const harness = createManagedScorerHarness();
    const definition = evaluate({
      id: "support",
      task,
      cases: [{ id: "refund", input: { question: "yes" } }],
    });
    const plan = await planEval(
      definition,
      { ...managedScorerSource, maxCostUsd: 0.03 },
      {
        ...harness.planning,
        costEstimator: {
          estimate: () => ({
            kind: "known",
            maximumUsd: 0.03,
            source: "managed_metadata",
          }),
        },
      },
    );
    const reservations = createMemoryEvalReservationPort(0.05);
    const taskExecute = vi.fn(async () => ({
      output: "yes",
      response: response(),
      capturedSignals: [],
      runIds: ["task-run"],
      metrics: { durationMs: 1, costUsd: 0.01 },
      observedIdentity: taskIdentity,
    }));
    const runWrite = vi.fn();
    let nextRun = 0;
    const ports = {
      taskHost: { execute: taskExecute },
      clock: { now: () => 1 },
      ids: { next: () => `eval-run-${++nextRun}` },
      runStore: { write: runWrite },
      reservations,
    };

    const results = await Promise.allSettled([
      executeEvalPlan(plan, ports),
      executeEvalPlan(plan, ports),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect(
      results.find((result) => result.status === "rejected"),
    ).toMatchObject({
      reason: {
        name: "EvalCostReservationError",
        reason: "budget_exhausted",
      },
    });
    expect(taskExecute).toHaveBeenCalledOnce();
    expect(runWrite).toHaveBeenCalledOnce();
  });
});
