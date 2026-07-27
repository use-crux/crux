import { expect, it, vi } from "vitest";

import { evalContext, tryEvalContext } from "../../src/eval";
import { evaluate } from "../../src/eval/evaluate";
import { executeEvalPlan } from "../../src/eval/internal/executor";
import { executeObservedOpaqueTaskForInternalUse } from "../../src/eval/internal/observed-task";
import { planEval } from "../../src/eval/internal/planner";
import type { EvalExecutionPorts } from "../../src/eval/internal/ports";
import {
  observe,
  subscribeObservability,
  type CruxGraphRecord,
} from "../../src/observability";
import { createDeadlineClock } from "./deadline-clock.fixture";
import { nonBillablePlanningPorts } from "./reuse-test-harness";

export const cellDeadlineBehavior = (): void => {
  it("settles when an opaque task ignores cancellation", async () => {
    const deadlineClock = createDeadlineClock();
    let context: ReturnType<typeof evalContext> | undefined;
    let observedRunId: string | undefined;
    let terminalSignalWasAborted: boolean | undefined;
    const records: CruxGraphRecord[] = [];
    const unsubscribe = subscribeObservability((record) => {
      records.push(record);
      if (
        record.type === "run:start" &&
        record.rootPrimitive === "eval.case"
      ) {
        observedRunId = record.runId;
      }
      if (
        record.type === "run:end" &&
        record.runId === observedRunId &&
        record.status === "cancelled"
      ) {
        terminalSignalWasAborted = context?.signal.aborted;
      }
    });
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const task = async () => {
      const span = observe.openSpan({
        name: "started generation",
        primitive: "generation.call",
      });
      span.end();
      markStarted?.();
      context = evalContext();
      await new Promise<never>(() => undefined);
    };
    const evalValue = evaluate({
      id: "ignored-cancellation",
      task,
      timeout: { totalMs: 1_000 },
      cases: [{ id: "never-settles", input: undefined }],
    });
    const plan = await planEval(
      evalValue,
      {
        sourceKey: {
          relativeFile: "ignored-cancellation.eval.ts",
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
    } satisfies EvalExecutionPorts);

    await started;
    deadlineClock.advance(1_000);
    const run = await execution;
    unsubscribe();

    expect(context?.signal.aborted).toBe(true);
    expect(context?.signal.reason).toMatchObject({
      name: "TimeoutError",
      budget: "total",
      limitMs: 1_000,
    });
    expect(terminalSignalWasAborted).toBe(false);
    expect(
      records.filter(
        (record) =>
          record.type === "run:end" && record.runId === observedRunId,
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
    expect(run).toMatchObject({
      status: "complete",
      passed: false,
      cells: [
        {
          status: "timed_out",
          task: { status: "timed_out" },
          timeout: { budget: "total", limitMs: 1_000 },
          metrics: { durationMs: 1_000 },
          runIds: [observedRunId],
          capturedSignals: ["modelCalls"],
        },
      ],
      aggregates: {
        current: {
          cells: 1,
          passed: 0,
          failed: 0,
          errored: 0,
          timedOut: 1,
          skipped: 0,
          passRate: 0,
        },
      },
    });
    expect(run.cells[0]).not.toHaveProperty("error");
  });

  it("keeps context and timers scoped to the live task only", async () => {
    const deadlineClock = createDeadlineClock();
    let taskContext: ReturnType<typeof evalContext> | undefined;
    const scorer = vi.fn(() => {
      expect(tryEvalContext()).toBeUndefined();
      return { name: "exact", score: 1 };
    });
    const assertion = vi.fn(({ output, expect: assert }) => {
      expect(tryEvalContext()).toBeUndefined();
      assert(output).toBe("complete");
    });
    const task = async () => {
      const beforeAwait = evalContext();
      await Promise.resolve();
      expect(evalContext()).toBe(beforeAwait);
      taskContext = beforeAwait;
      return "complete";
    };
    const evalValue = evaluate({
      id: "task-context-lifetime",
      task,
      timeout: { totalMs: 1_000, stepMs: 250 },
      cases: [{ id: "complete", input: undefined }],
      scorers: [scorer],
      expect: assertion,
    });
    const plan = await planEval(
      evalValue,
      {
        sourceKey: {
          relativeFile: "task-context-lifetime.eval.ts",
          export: "default",
        },
      },
      nonBillablePlanningPorts(),
    );
    const run = await executeEvalPlan(plan, {
      taskHost: {
        execute: async ({ task: taskValue }) => ({
          output: await (taskValue as typeof task)(),
          capturedSignals: [],
          runIds: [],
          metrics: { durationMs: 1 },
        }),
      },
      clock: { now: deadlineClock.now },
      cellDeadlineClock: deadlineClock,
      ids: { next: () => "eval-run-1" },
      runStore: {
        write: async () => {
          expect(tryEvalContext()).toBeUndefined();
        },
      },
    });

    expect(run.cells[0]?.status).toBe("passed");
    expect(taskContext?.timeout).toEqual({ stepMs: 250 });
    expect(taskContext?.timeout).toBe(plan.cells[0]?.timeout.nested);
    expect(scorer).toHaveBeenCalledOnce();
    expect(assertion).toHaveBeenCalledOnce();
    expect(deadlineClock.pendingTimers()).toBe(0);
    deadlineClock.advance(10_000);
    expect(taskContext?.signal.aborted).toBe(false);
  });
};
