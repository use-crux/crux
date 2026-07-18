import { describe, expect, it, vi } from "vitest";

import { executeEvalPlan } from "../../src/eval/internal/executor";
import { planEval } from "../../src/eval/internal/planner";
import {
  createManagedScorerHarness,
  managedScorerDefinition,
  managedScorerSource,
} from "./managed-scorer-test-harness";

describe("Eval cost admission", () => {
  it("marks built-in managed judges as inheriting the task model for estimation", async () => {
    const harness = createManagedScorerHarness();
    const estimate = vi.fn(() => ({ kind: "none" as const }));

    await planEval(
      managedScorerDefinition("Is it helpful?"),
      managedScorerSource,
      {
        ...harness.planning,
        costEstimator: { estimate },
      },
    );

    expect(estimate).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "scorer",
        scorerName: "helpful",
        inheritTaskModel: true,
      }),
    );
  });

  it("treats a missing estimator as unknown billable work", async () => {
    const harness = createManagedScorerHarness();
    const { costEstimator: _missing, ...planning } = harness.planning;
    const plan = await planEval(
      managedScorerDefinition("Is it helpful?"),
      { ...managedScorerSource, maxCostUsd: 10 },
      planning as typeof harness.planning,
    );

    expect(plan.cost).toMatchObject({
      unknownActionCount: 2,
      admission: { status: "blocked", reason: "unknown_cost_under_cap" },
      actions: [
        { estimate: { kind: "unknown", source: "unknown" } },
        { estimate: { kind: "unknown", source: "unknown" } },
      ],
    });
  });

  it("blocks unattended unknown-cost work before execution when no cap is supplied", async () => {
    const harness = createManagedScorerHarness();
    const plan = await planEval(
      managedScorerDefinition("Is it helpful?"),
      managedScorerSource,
      {
        ...harness.planning,
        costEstimator: {
          estimate: () => ({ kind: "unknown", source: "unknown" }),
        },
      },
    );

    expect(plan.cost).toMatchObject({
      admission: {
        status: "blocked",
        reason: "max_cost_required",
      },
      knownMaximumUsd: 0,
      unknownActionCount: 2,
      actions: [
        { kind: "task", estimate: { kind: "unknown" } },
        { kind: "scorer", estimate: { kind: "unknown" } },
      ],
    });

    const taskExecute = vi.fn();
    const scorerExecute = vi.fn();
    const runWrite = vi.fn();
    await expect(
      executeEvalPlan(plan, {
        taskHost: { execute: taskExecute },
        externalScorerHost: { execute: scorerExecute },
        clock: { now: vi.fn() },
        ids: { next: vi.fn() },
        runStore: { write: runWrite },
      }),
    ).rejects.toMatchObject({
      name: "EvalCostAdmissionError",
      reason: "max_cost_required",
    });
    expect(taskExecute).not.toHaveBeenCalled();
    expect(scorerExecute).not.toHaveBeenCalled();
    expect(runWrite).not.toHaveBeenCalled();
  });

  it("admits the exact known task and judge maximum and rejects a lower cap", async () => {
    const harness = createManagedScorerHarness();
    const planning = {
      ...harness.planning,
      costEstimator: {
        estimate: (action: { readonly kind: "task" | "scorer" }) =>
          action.kind === "task"
            ? ({
                kind: "known" as const,
                maximumUsd: 0.02,
                source: "managed_metadata" as const,
              } as const)
            : ({
                kind: "known" as const,
                maximumUsd: 0.03,
                source: "config_override" as const,
              } as const),
      },
    };

    const exact = await planEval(
      managedScorerDefinition("Is it helpful?"),
      { ...managedScorerSource, maxCostUsd: 0.05 },
      planning,
    );
    const insufficient = await planEval(
      managedScorerDefinition("Is it helpful?"),
      { ...managedScorerSource, maxCostUsd: 0.049 },
      planning,
    );
    const uncapped = await planEval(
      managedScorerDefinition("Is it helpful?"),
      managedScorerSource,
      planning,
    );

    expect(exact.cost).toMatchObject({
      knownMaximumUsd: 0.05,
      unknownActionCount: 0,
      admission: {
        status: "admitted",
        costControl: "max_cost",
        maxCostUsd: 0.05,
      },
      actions: [
        {
          kind: "task",
          estimate: { source: "managed_metadata", maximumUsd: 0.02 },
        },
        {
          kind: "scorer",
          estimate: { source: "config_override", maximumUsd: 0.03 },
        },
      ],
    });
    expect(insufficient.cost.admission).toEqual({
      status: "blocked",
      reason: "max_cost_exceeded",
    });
    expect(uncapped.cost.admission).toEqual({
      status: "blocked",
      reason: "max_cost_required",
    });
  });

  it("rejects unknown costs under a hard cap", async () => {
    const harness = createManagedScorerHarness();
    const plan = await planEval(
      managedScorerDefinition("Is it helpful?"),
      { ...managedScorerSource, maxCostUsd: 10 },
      {
        ...harness.planning,
        costEstimator: {
          estimate: () => ({ kind: "unknown", source: "unknown" }),
        },
      },
    );

    expect(plan.cost.admission).toEqual({
      status: "blocked",
      reason: "unknown_cost_under_cap",
    });
  });

  it("confirms unknown interactive cost once and records accept or decline", async () => {
    const harness = createManagedScorerHarness();
    const estimate = () => ({
      kind: "unknown" as const,
      source: "unknown" as const,
    });
    const accept = vi.fn(async () => true);
    const decline = vi.fn(async () => false);

    const accepted = await planEval(
      managedScorerDefinition("Is it helpful?"),
      { ...managedScorerSource, interactive: true },
      {
        ...harness.planning,
        costEstimator: { estimate },
        costConfirmation: { confirm: accept },
      },
    );
    const declined = await planEval(
      managedScorerDefinition("Is it helpful?"),
      { ...managedScorerSource, interactive: true },
      {
        ...harness.planning,
        costEstimator: { estimate },
        costConfirmation: { confirm: decline },
      },
    );

    expect(accept).toHaveBeenCalledOnce();
    expect(accept).toHaveBeenCalledWith({
      knownMaximumUsd: 0,
      unknownActions: expect.arrayContaining([
        expect.objectContaining({ kind: "task" }),
        expect.objectContaining({ kind: "scorer" }),
      ]),
    });
    expect(accepted.cost.admission).toEqual({
      status: "admitted",
      costControl: "unknown",
    });
    expect(decline).toHaveBeenCalledOnce();
    expect(declined.cost.admission).toEqual({
      status: "blocked",
      reason: "confirmation_declined",
    });
  });

  it("keeps plan-only admission side-effect free and reports pending confirmation", async () => {
    const harness = createManagedScorerHarness();
    const confirm = vi.fn(async () => true);
    const plan = await planEval(
      managedScorerDefinition("Is it helpful?"),
      { ...managedScorerSource, interactive: true, plan: true },
      {
        ...harness.planning,
        costEstimator: {
          estimate: () => ({ kind: "unknown", source: "unknown" }),
        },
        costConfirmation: { confirm },
      },
    );

    expect(confirm).not.toHaveBeenCalled();
    expect(harness.taskExecute).not.toHaveBeenCalled();
    expect(harness.scorerExecute).not.toHaveBeenCalled();
    expect(plan.cost).toMatchObject({
      planOnly: true,
      admission: {
        status: "confirmation_required",
        reason: "unknown_cost",
      },
    });

    const execute = vi.fn();
    const runWrite = vi.fn();
    await expect(
      executeEvalPlan(plan, {
        taskHost: { execute },
        clock: { now: vi.fn() },
        ids: { next: vi.fn() },
        runStore: { write: runWrite },
      }),
    ).rejects.toMatchObject({ name: "EvalCostAdmissionError" });
    expect(execute).not.toHaveBeenCalled();
    expect(runWrite).not.toHaveBeenCalled();
  });
});
