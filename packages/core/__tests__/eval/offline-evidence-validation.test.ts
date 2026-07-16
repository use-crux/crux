import { describe, expect, it, vi } from "vitest";

import { evaluate } from "../../src/eval/evaluate";
import { executeEvalPlan } from "../../src/eval/internal/executor";
import { planEval } from "../../src/eval/internal/planner";
import {
  createManagedScorerHarness,
  managedScorerDefinition,
  managedScorerSource,
  task,
} from "./managed-scorer-test-harness";

describe("strict offline evidence validation", () => {
  it("reports corrupt scorer evidence as a scorer miss while retaining the task hit", async () => {
    const harness = createManagedScorerHarness();
    await executeEvalPlan(
      await planEval(
        managedScorerDefinition("Is it helpful?"),
        managedScorerSource,
        harness.planning,
      ),
      harness.execution(),
    );
    const scorerEntry = [...harness.entries.entries()].find(
      ([, value]) => isRecord(value) && "scorerResultCacheEpoch" in value,
    );
    expect(scorerEntry).toBeDefined();
    harness.entries.set(scorerEntry![0], {
      ...scorerEntry![1],
      fingerprint: "corrupt",
    });
    harness.taskExecute.mockClear();
    harness.scorerExecute.mockClear();

    const plan = await planEval(
      managedScorerDefinition("Is it helpful?"),
      { ...managedScorerSource, offline: true },
      harness.planning,
    );

    expect(plan.cells[0]?.action.kind).toBe("reuse");
    expect(plan.preflight.misses).toMatchObject([
      {
        kind: "scorer",
        scorerName: "helpful",
        reason: "no_exact_evidence",
      },
    ]);
    expect(harness.taskExecute).not.toHaveBeenCalled();
    expect(harness.scorerExecute).not.toHaveBeenCalled();
  });

  it("classifies an opaque task as external and missing without invoking it", async () => {
    const harness = createManagedScorerHarness();
    const opaqueTask = vi.fn(async (input: { readonly question: string }) =>
      input.question.toUpperCase(),
    );
    const definition = evaluate({
      id: "opaque",
      task: opaqueTask,
      cases: [{ id: "one", input: { question: "Refund?" } }],
    });

    const plan = await planEval(
      definition,
      {
        sourceKey: { relativeFile: "opaque.eval.ts", export: "default" },
        offline: true,
      },
      harness.planning,
    );

    expect(plan.preflight.misses).toMatchObject([
      {
        kind: "task",
        caseId: "one",
        reason: "identity_unavailable",
      },
    ]);
    expect(opaqueTask).not.toHaveBeenCalled();
  });

  it("blocks an unclassified custom scorer instead of trusting it as local", async () => {
    const harness = createManagedScorerHarness();
    const taskOnly = evaluate({
      id: "support",
      task,
      cases: [{ id: "refund", input: { question: "yes" } }],
    });
    await executeEvalPlan(
      await planEval(taskOnly, managedScorerSource, harness.planning),
      harness.execution(),
    );
    const unknownScorer = vi.fn(() => ({ name: "custom", score: 1 }));
    const definition = evaluate({
      id: "support",
      task,
      cases: [{ id: "refund", input: { question: "yes" } }],
      scorers: [unknownScorer],
    });

    const plan = await planEval(
      definition,
      { ...managedScorerSource, offline: true },
      harness.planning,
    );

    expect(plan.cells[0]?.action.kind).toBe("reuse");
    expect(plan.preflight.misses).toMatchObject([
      {
        kind: "scorer",
        externalKind: "unknown",
        reason: "external_classification_unknown",
      },
    ]);
    expect(unknownScorer).not.toHaveBeenCalled();
  });

  it("admits an explicitly local code scorer and recomputes it offline", async () => {
    const harness = createManagedScorerHarness();
    const taskOnly = evaluate({
      id: "support",
      task,
      cases: [{ id: "refund", input: { question: "yes" } }],
    });
    await executeEvalPlan(
      await planEval(taskOnly, managedScorerSource, harness.planning),
      harness.execution(),
    );
    harness.taskExecute.mockClear();
    const scorerBody = vi.fn(() => ({ name: "local", score: 1 }));
    const localScorer = Object.assign(scorerBody, {
      scorerName: "local" as const,
      costClass: "code" as const,
    });
    const definition = evaluate({
      id: "support",
      task,
      cases: [{ id: "refund", input: { question: "yes" } }],
      scorers: [localScorer],
    });
    const plan = await planEval(
      definition,
      { ...managedScorerSource, offline: true },
      harness.planning,
    );

    expect(plan.preflight).toMatchObject({ status: "admitted", misses: [] });
    const run = await executeEvalPlan(plan, harness.execution());

    expect(harness.taskExecute).not.toHaveBeenCalled();
    expect(scorerBody).toHaveBeenCalledOnce();
    expect(run.cells[0]?.scores).toMatchObject([
      { name: "local", reason: "deterministic_local" },
    ]);
  });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
