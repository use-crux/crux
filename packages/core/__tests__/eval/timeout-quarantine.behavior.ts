import { expect, it, vi } from "vitest";

import { evalContext } from "../../src/eval";
import { evaluate } from "../../src/eval/evaluate";
import { executeEvalPlan } from "../../src/eval/internal/executor";
import { executeObservedOpaqueTaskForInternalUse } from "../../src/eval/internal/observed-task";
import { planEval } from "../../src/eval/internal/planner";
import {
  observe,
  subscribeObservability,
  type CruxGraphRecord,
} from "../../src/observability";
import { createDeadlineClock } from "./deadline-clock.fixture";
import {
  memoryEvidenceStore,
  nonBillablePlanningPorts,
  planningPorts,
  task as managedTask,
} from "./reuse-test-harness";

export const timeoutQuarantineBehavior = (): void => {
  it("quarantines a late rejection and advances to the next cell", async () => {
    const deadlineClock = createDeadlineClock();
    const unhandled: unknown[] = [];
    const records: CruxGraphRecord[] = [];
    const unsubscribe = subscribeObservability((record) =>
      records.push(record),
    );
    const onUnhandled = (error: unknown) => void unhandled.push(error);
    process.on("unhandledRejection", onUnhandled);
    let rejectSlow: ((error: Error) => void) | undefined;
    let markSlowStarted: (() => void) | undefined;
    const slowStarted = new Promise<void>((resolve) => {
      markSlowStarted = resolve;
    });
    const task = async (input: string) => {
      if (input === "fast") return "next-cell";
      evalContext();
      markSlowStarted?.();
      try {
        return await new Promise<string>((_resolve, reject) => {
          rejectSlow = reject;
        });
      } catch (error) {
        const late = observe.openSpan({
          name: "late Eval evidence",
          primitive: "generation.call",
        });
        late.end();
        throw error;
      }
    };
    const evalValue = evaluate({
      id: "terminal-winner",
      task,
      timeout: { totalMs: 1_000 },
      cases: [
        { id: "slow", input: "slow" },
        { id: "fast", input: "fast" },
      ],
    });
    const plan = await planEval(
      evalValue,
      {
        sourceKey: {
          relativeFile: "terminal-winner.eval.ts",
          export: "default",
        },
      },
      nonBillablePlanningPorts(),
    );
    const execution = executeEvalPlan(plan, {
      taskHost: {
        execute: (request) =>
          executeObservedOpaqueTaskForInternalUse(request, deadlineClock.now),
      },
      clock: { now: deadlineClock.now },
      cellDeadlineClock: deadlineClock,
      ids: { next: () => "eval-run-1" },
      runStore: { write: async () => undefined },
    });

    try {
      await slowStarted;
      deadlineClock.advance(1_000);
      const run = await execution;
      expect(
        run.cells.map(({ status, output }) => ({ status, output })),
      ).toEqual([
        { status: "timed_out", output: undefined },
        { status: "passed", output: "next-cell" },
      ]);

      rejectSlow?.(new Error("late rejection"));
      await new Promise<void>((resolve) => setImmediate(resolve));
      const slowRoot = records.find(
        (record) =>
          record.type === "run:start" &&
          record.rootPrimitive === "eval.case" &&
          record.attributes?.caseId === "slow",
      );
      expect(unhandled).toEqual([]);
      expect(run.cells[0]?.status).toBe("timed_out");
      expect(
        records.filter(
          (record) =>
            record.type === "run:end" && record.runId === slowRoot?.runId,
        ),
      ).toEqual([
        expect.objectContaining({
          status: "cancelled",
          attributes: {
            evalOutcome: "timed_out",
            timeoutBudget: "total",
            timeoutLimitMs: 1_000,
          },
        }),
      ]);
      expect(JSON.stringify(records)).not.toContain("late Eval evidence");
    } finally {
      unsubscribe();
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("does not assess or persist evidence for a timed-out task", async () => {
    const deadlineClock = createDeadlineClock();
    const evidenceStore = memoryEvidenceStore();
    const scorer = Object.assign(
      vi.fn(() => ({ name: "quality", score: 1 })),
      { scorerName: "quality" as const, costClass: "code" as const },
    );
    const assertion = vi.fn();
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const evalValue = evaluate({
      id: "timeout-effects",
      task: managedTask,
      timeout: { totalMs: 250 },
      cases: [{ id: "slow", input: { question: "wait" } }],
      scorers: [scorer],
      expect: assertion,
    });
    const plan = await planEval(
      evalValue,
      {
        sourceKey: {
          relativeFile: "timeout-effects.eval.ts",
          export: "default",
        },
      },
      planningPorts(evidenceStore),
    );
    const execution = executeEvalPlan(plan, {
      taskHost: {
        execute: async () => {
          markStarted?.();
          evalContext();
          return new Promise<never>(() => undefined);
        },
      },
      clock: { now: deadlineClock.now },
      cellDeadlineClock: deadlineClock,
      ids: { next: () => "eval-run-1" },
      runStore: { write: async () => undefined },
      evidenceStore,
    });

    await started;
    deadlineClock.advance(250);
    const run = await execution;

    expect(plan.cells[0]?.scorerContracts).toEqual([
      {
        name: "quality",
        contractFingerprint: "crux.eval.local-scorer.unversioned",
      },
    ]);
    expect(run).toMatchObject({
      status: "complete",
      passed: false,
      cells: [
        {
          status: "timed_out",
          task: { status: "timed_out" },
          timeout: { budget: "total", limitMs: 250 },
          scorerContracts: [
            {
              name: "quality",
              contractFingerprint: "crux.eval.local-scorer.unversioned",
            },
          ],
          assertions: { ran: 0, notEvaluated: 0, outcomes: [] },
          scores: [],
        },
      ],
      provenance: { evidenceStore: { write: "not_attempted" } },
    });
    expect(run).not.toHaveProperty("reasons");
    expect(evidenceStore.entries.size).toBe(0);
    expect(scorer).not.toHaveBeenCalled();
    expect(assertion).not.toHaveBeenCalled();
  });
};
