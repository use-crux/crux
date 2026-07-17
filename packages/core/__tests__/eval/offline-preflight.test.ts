import { describe, expect, it, vi } from "vitest";

import { evaluate } from "../../src/eval/evaluate";
import type { EvalCaseContext } from "../../src/eval/case";
import { executeEvalPlan } from "../../src/eval/internal/executor";
import { renderEvalOfflineMisses } from "../../src/eval/internal/offline";
import { planEval } from "../../src/eval/internal/planner";
import { scorers } from "../../src/eval/internal/scorers/types";
import {
  createManagedScorerHarness,
  managedScorerDefinition,
  managedScorerSource,
  task,
} from "./managed-scorer-test-harness";

describe("strict offline Eval preflight", () => {
  it("returns every task-dependent external miss before any execution or write", async () => {
    const harness = createManagedScorerHarness();
    const evidenceWrite = vi.spyOn(harness.evidenceStore, "write");
    const plan = await planEval(
      managedScorerDefinition("Is it helpful?"),
      { ...managedScorerSource, offline: true },
      harness.planning,
    );

    expect(plan.preflight).toMatchObject({
      status: "blocked",
      reason: "offline_miss",
      misses: [
        {
          kind: "task",
          actionId: "refund:current:0:task",
          caseId: "refund",
          variant: "current",
          trial: 0,
          reason: "no_exact_evidence",
        },
        {
          kind: "scorer",
          actionId: "refund:current:0:score:0:helpful",
          caseId: "refund",
          variant: "current",
          trial: 0,
          scorerName: "helpful",
          externalKind: "model",
          reason: "task_dependency_unresolved",
        },
      ],
    });
    expect(renderEvalOfflineMisses(plan.evalId, plan.preflight.misses))
      .toMatchInlineSnapshot(`
      "Offline run needs 2 uncached results; no external calls were made.
      - support/refund/current/trial-1: no exact task evidence
      - support/refund/current/helpful: external scorer unresolved because task evidence is missing
      Run \`crux eval support\` online, or remove \`--offline\`."
    `);

    const taskExecute = vi.fn();
    const scorerExecute = vi.fn();
    const clock = vi.fn();
    const nextId = vi.fn();
    const runWrite = vi.fn();
    await expect(
      executeEvalPlan(plan, {
        evidenceStore: harness.evidenceStore,
        taskHost: { execute: taskExecute },
        externalScorerHost: { execute: scorerExecute },
        clock: { now: clock },
        ids: { next: nextId },
        runStore: { write: runWrite },
      }),
    ).rejects.toMatchObject({
      name: "EvalOfflinePreflightError",
      misses: plan.preflight.misses,
    });

    expect(taskExecute).not.toHaveBeenCalled();
    expect(scorerExecute).not.toHaveBeenCalled();
    expect(clock).not.toHaveBeenCalled();
    expect(nextId).not.toHaveBeenCalled();
    expect(evidenceWrite).not.toHaveBeenCalled();
    expect(runWrite).not.toHaveBeenCalled();
  });

  it("recomputes local checks and persists a run when every external result hits", async () => {
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
    const evidenceWrite = vi.spyOn(harness.evidenceStore, "write");
    evidenceWrite.mockClear();
    const localCheck = vi.fn(
      ({
        output,
        expect: assert,
      }: EvalCaseContext<
        { readonly question: string },
        string,
        string,
        never
      >) => {
        assert(output).toBe("yes");
      },
    );
    const definition = evaluate({
      id: "support",
      task,
      cases: [{ id: "refund", input: { question: "yes" }, expected: "yes" }],
      scorers: [scorers.judge({ name: "helpful", rubric: "Is it helpful?" })],
      expect: localCheck,
    });
    const plan = await planEval(
      definition,
      { ...managedScorerSource, offline: true },
      harness.planning,
    );
    const runWrite = vi.fn();

    expect(plan.preflight).toEqual({
      status: "admitted",
      offline: true,
      misses: [],
    });
    const run = await executeEvalPlan(plan, {
      ...harness.execution(),
      runStore: { write: runWrite },
    });

    expect(harness.taskExecute).not.toHaveBeenCalled();
    expect(harness.scorerExecute).not.toHaveBeenCalled();
    expect(evidenceWrite).not.toHaveBeenCalled();
    expect(localCheck).toHaveBeenCalledOnce();
    expect(run.cells[0]).toMatchObject({
      task: { status: "reused" },
      scores: [{ work: { status: "reused" } }],
      assertions: { ran: 1 },
    });
    expect(runWrite).toHaveBeenCalledWith(run);
  });

  it("treats corrupt task evidence as a task miss and keeps callbacks dormant", async () => {
    const harness = createManagedScorerHarness();
    const throwingCheck = vi.fn(() => {
      throw new Error("must not run during preflight");
    });
    const definition = evaluate({
      id: "support",
      task,
      cases: [{ id: "refund", input: { question: "yes" } }],
      scorers: [scorers.judge({ name: "helpful", rubric: "Is it helpful?" })],
      expect: throwingCheck,
    });
    const onlinePlan = await planEval(
      definition,
      managedScorerSource,
      harness.planning,
    );
    const taskAction = onlinePlan.cells[0]?.action;
    const evidenceKey =
      taskAction?.kind === "execute" ? taskAction.evidenceKey : undefined;
    expect(evidenceKey).toBeTypeOf("string");
    harness.entries.set(evidenceKey!, {
      schemaVersion: 1,
      status: "complete",
      key: evidenceKey,
      fingerprint: "corrupt",
    });

    const offlinePlan = await planEval(
      definition,
      { ...managedScorerSource, offline: true },
      harness.planning,
    );

    expect(throwingCheck).not.toHaveBeenCalled();
    expect(offlinePlan.preflight.misses).toMatchObject([
      { kind: "task", reason: "no_exact_evidence" },
      { kind: "scorer", reason: "task_dependency_unresolved" },
    ]);
  });

  it("classifies an unidentified custom model scorer as external before invoking it", async () => {
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
    const scorerBody = vi.fn(async () => ({ name: "custom", score: 1 }));
    const customModelScorer = Object.assign(scorerBody, {
      scorerName: "custom" as const,
      costClass: "model" as const,
    });
    const definition = evaluate({
      id: "support",
      task,
      cases: [{ id: "refund", input: { question: "yes" } }],
      scorers: [customModelScorer],
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
        scorerName: "custom",
        reason: "identity_unavailable",
      },
    ]);
    expect(scorerBody).not.toHaveBeenCalled();
  });
});
