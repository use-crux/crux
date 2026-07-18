import { describe, expect, it } from "vitest";

import { evaluate } from "../../src/eval/evaluate";
import { executeEvalPlan } from "../../src/eval/internal/executor";
import { planEval } from "../../src/eval/internal/planner";
import type {
  EvalClock,
  EvalIdGenerator,
  EvalRunStore,
  EvalTaskHost,
} from "../../src/eval/internal/ports";
import { nonBillablePlanningPorts } from "./reuse-test-harness";

describe("portable Eval kernel", () => {
  it("preserves scalar opaque-task inputs in plans and persisted runs", async () => {
    const task = Object.assign(async (input: string) => input.toUpperCase(), {
      _tag: "CruxTask" as const,
      operation: "function" as const,
    });
    const evalValue = evaluate({
      id: "scalar-input",
      task,
      cases: [{ id: "one", input: "hello", expected: "HELLO" }],
    });
    const plan = await planEval(
      evalValue,
      {
        sourceKey: { relativeFile: "scalar.eval.ts", export: "default" },
      },
      nonBillablePlanningPorts(),
    );
    const writes: unknown[] = [];
    const run = await executeEvalPlan(plan, {
      taskHost: {
        execute: async ({ input }) => ({
          output: String(input).toUpperCase(),
          capturedSignals: [],
          runIds: [],
          metrics: { durationMs: 1 },
        }),
      },
      clock: { now: () => 1 },
      ids: { next: () => "scalar-run" },
      runStore: { write: async (value) => void writes.push(value) },
    });

    expect(plan.cells[0]?.input).toBe("hello");
    expect(run.cells[0]?.input).toBe("hello");
    expect(writes).toEqual([run]);
  });

  it("plans and executes one live Current cell before persisting the run", async () => {
    const task = Object.assign(
      async (input: { question: string }) => ({ answer: input.question }),
      { _tag: "CruxTask" as const, operation: "function" as const },
    );
    const evalValue = evaluate({
      id: "support",
      task,
      cases: [
        {
          id: "refund",
          input: { question: "yes" },
          expected: { answer: "yes" },
        },
      ],
      expect: ({ output, expect: assert }) => {
        assert(output.answer).toBe("yes");
      },
    });
    const plan = await planEval(
      evalValue,
      {
        sourceKey: { relativeFile: "support.eval.ts", export: "default" },
      },
      nonBillablePlanningPorts(),
    );

    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.cells)).toBe(true);
    expect(plan.cells).toHaveLength(1);
    expect(plan.cells[0]).toMatchObject({
      caseId: "refund",
      variant: "current",
      trial: 0,
      action: { kind: "execute", reason: "identity_unavailable" },
    });

    const hostCalls: unknown[] = [];
    const writes: unknown[] = [];
    const taskHost: EvalTaskHost = {
      async execute(request) {
        expect(writes).toHaveLength(0);
        hostCalls.push(request);
        return {
          output: { answer: request.input.question },
          response: {
            content: [],
            text: request.input.question,
            steps: [],
            finalStep: {
              content: [],
              text: request.input.question,
              finishReason: "stop",
              responseId: "response-1",
              modelId: "fake",
              warnings: [],
            },
            messages: [],
            warnings: [],
          },
          capturedSignals: [],
          runIds: ["task-run-1"],
          metrics: { durationMs: 20 },
        };
      },
    };
    const times = [100, 125];
    const clock: EvalClock = { now: () => times.shift() ?? 125 };
    const ids: EvalIdGenerator = { next: () => "eval-run-1" };
    const runStore: EvalRunStore = {
      async write(run) {
        writes.push(run);
      },
    };

    const run = await executeEvalPlan(plan, {
      taskHost,
      clock,
      ids,
      runStore,
    });

    expect(hostCalls).toHaveLength(1);
    expect(writes).toEqual([run]);
    expect(Object.isFrozen(run)).toBe(true);
    expect(run).toMatchObject({
      schemaVersion: 3,
      status: "complete",
      passed: true,
      runId: "eval-run-1",
      evalId: "support",
      sourceKey: { relativeFile: "support.eval.ts", export: "default" },
      startedAt: 100,
      endedAt: 125,
      blockingVariants: ["current"],
      cells: [
        {
          caseId: "refund",
          variant: "current",
          trial: 0,
          status: "passed",
          task: { status: "executed", reason: "identity_unavailable" },
          output: { answer: "yes" },
          expected: { answer: "yes" },
          assertions: { ran: 1, notEvaluated: 0 },
          runIds: ["task-run-1"],
        },
      ],
    });
  });
});
