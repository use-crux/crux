import { describe, expect, it, vi } from "vitest";

import { evaluate } from "../../src/eval/evaluate";
import { executeEvalPlan } from "../../src/eval/internal/executor";
import { planEval } from "../../src/eval/internal/planner";
import { createMemoryEvalReservationPort } from "../../src/eval/internal/reservation";
import {
  createManagedScorerHarness,
  managedScorerDefinition,
  managedScorerSource,
  response,
  task,
  taskIdentity,
} from "./managed-scorer-test-harness";

describe("Eval cost reservations", () => {
  it("requires a shared reservation boundary before capped work", async () => {
    const harness = createManagedScorerHarness();
    const plan = await planEval(
      managedScorerDefinition("Is it helpful?"),
      { ...managedScorerSource, maxCostUsd: 0.05 },
      {
        ...harness.planning,
        costEstimator: {
          estimate: (action) => ({
            kind: "known",
            maximumUsd: action.kind === "task" ? 0.02 : 0.03,
            source: "managed_metadata",
          }),
        },
      },
    );

    await expect(
      executeEvalPlan(plan, harness.execution()),
    ).rejects.toMatchObject({
      name: "EvalCostReservationError",
      reason: "reservation_unavailable",
    });
    expect(harness.taskExecute).not.toHaveBeenCalled();
    expect(harness.scorerExecute).not.toHaveBeenCalled();
  });

  it("atomically prevents concurrent reservations from exceeding the cap", async () => {
    const reservations = createMemoryEvalReservationPort(0.05);
    const [first, second] = await Promise.all([
      reservations.reserve({
        reservationId: "run-1",
        actionId: "task-1",
        maximumUsd: 0.03,
      }),
      reservations.reserve({
        reservationId: "run-2",
        actionId: "task-2",
        maximumUsd: 0.03,
      }),
    ]);

    expect([first.status, second.status].sort()).toEqual([
      "rejected",
      "reserved",
    ]);
    expect(reservations.snapshot().heldUsd).toBeCloseTo(0.03);
    expect(reservations.snapshot().spentUsd).toBe(0);
    expect(reservations.snapshot().availableUsd).toBeCloseTo(0.02);

    const winner = first.status === "reserved" ? "run-1" : "run-2";
    await reservations.settle({ reservationId: winner, actualUsd: 0.01 });
    await expect(
      reservations.reserve({
        reservationId: "run-3",
        actionId: "task-3",
        maximumUsd: 0.03,
      }),
    ).resolves.toEqual({ status: "reserved" });
  });

  it("reserves before task work and releases the excess after actual cost settles", async () => {
    const harness = createManagedScorerHarness();
    const reservations = createMemoryEvalReservationPort(0.02);
    const definition = evaluate({
      id: "support",
      task,
      cases: [{ id: "refund", input: { question: "yes" } }],
    });
    const plan = await planEval(
      definition,
      { ...managedScorerSource, maxCostUsd: 0.02 },
      {
        ...harness.planning,
        costEstimator: {
          estimate: () => ({
            kind: "known",
            maximumUsd: 0.02,
            source: "managed_metadata",
          }),
        },
      },
    );
    const execute = vi.fn(async () => {
      expect(reservations.snapshot().heldUsd).toBe(0.02);
      return {
        output: "yes",
        response: response(),
        capturedSignals: [],
        runIds: ["task-run-1"],
        metrics: { durationMs: 1, costUsd: 0.005 },
        observedIdentity: taskIdentity,
      };
    });

    const run = await executeEvalPlan(plan, {
      ...harness.execution(),
      taskHost: { execute },
      reservations,
    });

    expect(execute).toHaveBeenCalledOnce();
    expect(reservations.snapshot()).toEqual({
      heldUsd: 0,
      spentUsd: 0.005,
      availableUsd: 0.015,
    });
    expect(run).toMatchObject({
      costControl: "max_cost",
      cost: {
        actualUsd: 0.005,
        reservedMaximumUsd: 0.02,
        unknownActionCount: 0,
      },
    });
  });

  it("releases an output-dependent judge reservation on an exact evidence hit", async () => {
    const harness = createManagedScorerHarness();
    await executeEvalPlan(
      await planEval(
        managedScorerDefinition("Is it helpful?"),
        managedScorerSource,
        harness.planning,
      ),
      harness.execution(),
    );
    harness.taskExecute.mockClear();
    harness.scorerExecute.mockClear();
    const reservations = createMemoryEvalReservationPort(0.05);
    const plan = await planEval(
      managedScorerDefinition("Is it helpful?", {
        latency: { meanMs: 100 },
      }),
      { ...managedScorerSource, maxCostUsd: 0.05 },
      {
        ...harness.planning,
        costEstimator: {
          estimate: (action) => ({
            kind: "known",
            maximumUsd: action.kind === "task" ? 0.02 : 0.03,
            source: "managed_metadata",
          }),
        },
      },
    );
    const taskHost = vi.fn(async () => {
      expect(reservations.snapshot().heldUsd).toBe(0.05);
      return {
        output: "yes",
        response: response(),
        capturedSignals: [],
        runIds: ["task-run-2"],
        metrics: { durationMs: 1, costUsd: 0.01 },
        observedIdentity: taskIdentity,
      };
    });

    const run = await executeEvalPlan(plan, {
      ...harness.execution(),
      taskHost: { execute: taskHost },
      reservations,
    });

    expect(harness.scorerExecute).not.toHaveBeenCalled();
    expect(run.cells[0]?.scores[0]).toMatchObject({
      work: { status: "reused", reservation: "released" },
    });
    expect(reservations.snapshot()).toEqual({
      heldUsd: 0,
      spentUsd: 0.01,
      availableUsd: 0.04,
    });
  });

  it("releases dependent scorer budget when the task fails", async () => {
    const harness = createManagedScorerHarness();
    const reservations = createMemoryEvalReservationPort(0.05);
    const plan = await planEval(
      managedScorerDefinition("Is it helpful?"),
      { ...managedScorerSource, maxCostUsd: 0.05 },
      {
        ...harness.planning,
        costEstimator: {
          estimate: (action) => ({
            kind: "known",
            maximumUsd: action.kind === "task" ? 0.02 : 0.03,
            source: "managed_metadata",
          }),
        },
      },
    );

    const run = await executeEvalPlan(plan, {
      ...harness.execution(),
      taskHost: {
        execute: async () => {
          throw new Error("provider unavailable");
        },
      },
      reservations,
    });

    expect(harness.scorerExecute).not.toHaveBeenCalled();
    expect(run.status).toBe("incomplete");
    expect(reservations.snapshot().heldUsd).toBe(0);
    expect(reservations.snapshot().spentUsd).toBeCloseTo(0.02);
    expect(reservations.snapshot().availableUsd).toBeCloseTo(0.03);
  });
});
