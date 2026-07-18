import { describe, expect, it } from "vitest";

import { executeEvalPlan } from "../../src/eval/internal/executor";
import { planEval } from "../../src/eval/internal/planner";
import {
  createManagedScorerHarness,
  managedScorerDefinition,
  managedScorerSource,
} from "./managed-scorer-test-harness";

describe("managed scorer freshness", () => {
  it("bypasses exact task and judge evidence for explicit run freshness", async () => {
    const harness = createManagedScorerHarness();
    await executeEvalPlan(
      await planEval(
        managedScorerDefinition("Is it helpful?"),
        managedScorerSource,
        harness.planning,
      ),
      harness.execution(),
    );

    const freshPlan = await planEval(
      managedScorerDefinition("Is it helpful?"),
      { ...managedScorerSource, fresh: true },
      harness.planning,
    );
    expect(freshPlan.cells[0]).toMatchObject({
      action: { kind: "execute", reason: "fresh_requested" },
      scorerActions: [
        {
          kind: "after_task_output",
          evidenceRead: "bypass",
          reason: "output_dependency",
        },
      ],
    });
    const fresh = await executeEvalPlan(freshPlan, harness.execution());

    expect(harness.taskExecute).toHaveBeenCalledTimes(2);
    expect(harness.scorerExecute).toHaveBeenCalledTimes(2);
    expect(fresh.cells[0].scores[0]).toMatchObject({
      reason: "managed_external_executed",
      work: { status: "executed", reason: "fresh_requested" },
    });
  });

  it("resolves judge evidence normally after task performance freshness", async () => {
    const harness = createManagedScorerHarness();
    await executeEvalPlan(
      await planEval(
        managedScorerDefinition("Is it helpful?"),
        managedScorerSource,
        harness.planning,
      ),
      harness.execution(),
    );

    const plan = await planEval(
      managedScorerDefinition("Is it helpful?", {
        latency: { meanMs: 10 },
      }),
      managedScorerSource,
      harness.planning,
    );
    const run = await executeEvalPlan(plan, harness.execution());

    expect(plan.cells[0]).toMatchObject({
      action: { kind: "execute", reason: "performance_freshness" },
      scorerActions: [{ kind: "after_task_output", evidenceRead: "allow" }],
    });
    expect(harness.taskExecute).toHaveBeenCalledTimes(2);
    expect(harness.scorerExecute).toHaveBeenCalledOnce();
    expect(run.cells[0]?.scores[0]).toMatchObject({
      work: { status: "reused", reason: "exact_evidence" },
    });

    harness.setTaskOutput("changed");
    const changed = await executeEvalPlan(
      await planEval(
        managedScorerDefinition("Is it helpful?", {
          latency: { meanMs: 10 },
        }),
        managedScorerSource,
        harness.planning,
      ),
      harness.execution(),
    );

    expect(harness.taskExecute).toHaveBeenCalledTimes(3);
    expect(harness.scorerExecute).toHaveBeenCalledTimes(2);
    expect(changed.cells[0]?.scores[0]).toMatchObject({
      work: { status: "executed", reason: "no_exact_evidence" },
    });
  });

  it("reuses a judge when a fresh task returns the same declared inputs with a different provider response id", async () => {
    const harness = createManagedScorerHarness();
    await executeEvalPlan(
      await planEval(
        managedScorerDefinition("Is it helpful?"),
        managedScorerSource,
        harness.planning,
      ),
      harness.execution(),
    );
    harness.setTaskResponseId("response-2");

    const fresh = await executeEvalPlan(
      await planEval(
        managedScorerDefinition("Is it helpful?", {
          latency: { meanMs: 10 },
        }),
        managedScorerSource,
        harness.planning,
      ),
      harness.execution(),
    );

    expect(harness.taskExecute).toHaveBeenCalledTimes(2);
    expect(harness.scorerExecute).toHaveBeenCalledOnce();
    expect(fresh.cells[0]?.scores[0]).toMatchObject({
      status: "reused",
      work: { reason: "exact_evidence" },
    });
  });
});
