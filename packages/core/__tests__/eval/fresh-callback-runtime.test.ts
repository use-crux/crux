import { describe, expect, it, vi } from "vitest";

import { evaluate } from "../../src/eval/evaluate";
import { executeEvalPlan } from "../../src/eval/internal/executor";
import { planEval } from "../../src/eval/internal/planner";
import {
  createEvalMeta,
  guardEvalStepAccessor,
  PERFORMANCE_EVIDENCE_GUIDANCE,
} from "../../src/eval/internal/check-runtime";
import type { EvalExecutionPorts } from "../../src/eval/internal/ports";
import {
  memoryEvidenceStore,
  planningPorts,
  task,
  taskResult,
} from "./reuse-test-harness";

const sourceKey = {
  relativeFile: "support.eval.ts",
  export: "default" as const,
};

describe("Eval fresh callback runtime", () => {
  it("guards metadata duration without making its getter enumerable", () => {
    const ordinary = createEvalMeta(20, 0.01, false);
    const alias = ordinary as unknown as Record<string, unknown>;

    expect({ ...ordinary }).toEqual({ costUsd: 0.01 });
    expect(() => alias["durationMs"]).toThrowError(
      PERFORMANCE_EVIDENCE_GUIDANCE,
    );
    expect(createEvalMeta(20, undefined, true).durationMs).toBe(20);
  });

  it("guards step duration through aliases and computed access without breaking spread", () => {
    const raw = (() => ({
      output: "draft",
      status: "succeeded" as const,
      durationMs: 12,
    })) as never;
    const ordinary = guardEvalStepAccessor(raw, false)("draft");
    const alias = ordinary as unknown as Record<string, unknown>;

    expect({ ...ordinary }).toEqual({
      output: "draft",
      status: "succeeded",
    });
    expect(() => alias["durationMs"]).toThrowError(
      PERFORMANCE_EVIDENCE_GUIDANCE,
    );
    expect(guardEvalStepAccessor(raw, true)("draft").durationMs).toBe(12);
  });

  it("throws actionable timing guidance for ordinary callbacks on live and reused cells", async () => {
    const evidenceStore = memoryEvidenceStore();
    const host = vi.fn(async () => taskResult());
    const ports: EvalExecutionPorts = {
      evidenceStore,
      taskHost: { execute: host },
      clock: { now: () => 1 },
      ids: { next: () => "eval-run-1" },
      runStore: { write: async () => undefined },
    };
    const definition = evaluate({
      id: "support",
      task,
      cases: [{ id: "refund", input: { question: "Refund?" } }],
      expect: (context) => {
        const alias = context.expect as unknown as Record<string, unknown>;
        void alias["latency"];
      },
    });

    const first = await executeEvalPlan(
      await planEval(definition, { sourceKey }, planningPorts(evidenceStore)),
      ports,
    );
    const second = await executeEvalPlan(
      await planEval(definition, { sourceKey }, planningPorts(evidenceStore)),
      ports,
    );

    for (const run of [first, second]) {
      expect(run.cells[0]).toMatchObject({
        status: "errored",
        error: {
          phase: "expect",
          message: expect.stringContaining(
            "Performance evidence requires a live check",
          ),
        },
      });
    }
    expect(host).toHaveBeenCalledOnce();
  });

  it("keeps harmless spreads cache-friendly and exposes timing only when declared fresh", async () => {
    const evidenceStore = memoryEvidenceStore();
    const host = vi.fn(async () => taskResult());
    const ports: EvalExecutionPorts = {
      evidenceStore,
      taskHost: { execute: host },
      clock: { now: () => 1 },
      ids: { next: () => "eval-run-1" },
      runStore: { write: async () => undefined },
    };
    const ordinary = evaluate({
      id: "support",
      task,
      cases: [{ id: "refund", input: { question: "Refund?" } }],
      expect: (context) => {
        void { ...context };
        void { ...context.expect };
        void { ...context.meta };
        context.expect(context.output).toBe("yes");
      },
    });
    await executeEvalPlan(
      await planEval(ordinary, { sourceKey }, planningPorts(evidenceStore)),
      ports,
    );
    const fresh = evaluate({
      id: "support",
      task,
      cases: [{ id: "refund", input: { question: "Refund?" } }],
      expect: {
        fresh: true,
        check: (context) => {
          context.expect.latency.toBeUnderMs(100);
          context.expect(context.meta.durationMs).toBe(20);
        },
      },
    });
    const run = await executeEvalPlan(
      await planEval(fresh, { sourceKey }, planningPorts(evidenceStore)),
      ports,
    );

    expect(run.cells[0]).toMatchObject({
      status: "passed",
      task: {
        status: "executed",
        reason: "performance_freshness",
        freshnessSource: "eval_expect",
      },
      assertions: { ran: 2 },
    });
    expect(host).toHaveBeenCalledTimes(2);
  });

  it("passes the normalized managed response to ordinary and fresh callbacks", async () => {
    const evidenceStore = memoryEvidenceStore();
    const expectedResponse = taskResult().response;
    const host = vi.fn(async () => ({
      ...taskResult(),
      response: expectedResponse,
    }));
    const seen: unknown[] = [];
    const definition = evaluate({
      id: "managed-response",
      task,
      cases: [{ id: "refund", input: { question: "Refund?" } }],
      expect: (context) => {
        seen.push((context as unknown as { response: unknown }).response);
      },
      afterScores: {
        fresh: true,
        check: (context) => {
          seen.push((context as unknown as { response: unknown }).response);
        },
      },
    });

    await executeEvalPlan(
      await planEval(definition, { sourceKey }, planningPorts(evidenceStore)),
      {
        evidenceStore,
        taskHost: { execute: host },
        clock: { now: () => 1 },
        ids: { next: () => "eval-run-1" },
        runStore: { write: async () => undefined },
      },
    );

    expect(seen).toEqual([expectedResponse, expectedResponse]);
  });

  it("selects ordinary and fresh timing contexts independently after scoring", async () => {
    const evidenceStore = memoryEvidenceStore();
    const host = vi.fn(async () => taskResult());
    const definition = evaluate({
      id: "support-after-scores",
      task,
      afterScores: (context) => {
        void { ...context.meta };
        context.expect(context.output).toBe("yes");
      },
      cases: [
        {
          id: "refund",
          input: { question: "Refund?" },
          afterScores: {
            fresh: true,
            check: (context) => {
              context.expect.latency.toBeUnderMs(100);
              context.expect(context.meta.durationMs).toBe(20);
            },
          },
        },
      ],
    });
    const run = await executeEvalPlan(
      await planEval(
        definition,
        {
          sourceKey: {
            relativeFile: "support-after-scores.eval.ts",
            export: "default",
          },
        },
        planningPorts(evidenceStore),
      ),
      {
        evidenceStore,
        taskHost: { execute: host },
        clock: { now: () => 1 },
        ids: { next: () => "eval-run-1" },
        runStore: { write: async () => undefined },
      },
    );

    expect(run.cells[0]).toMatchObject({
      status: "passed",
      task: {
        reason: "performance_freshness",
        freshnessSource: "case_after_scores",
      },
      assertions: { ran: 3 },
    });
  });
});
