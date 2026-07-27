import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluate } from "../../src/eval/evaluate";
import { executeEvalPlan } from "../../src/eval/internal/executor";
import {
  executeObservedEvalTaskForInternalUse,
  executeObservedOpaqueTaskForInternalUse,
} from "../../src/eval/internal/observed-task";
import { planEval } from "../../src/eval/internal/planner";
import {
  attachEvalTaskDescriptorForInternalUse,
  getEvalTaskDescriptorForInternalUse,
} from "../../src/eval/internal/task";
import type { EvalTaskHostRequest } from "../../src/eval/internal/types";
import { TimeoutError } from "../../src/generation/timeout";
import {
  observe,
  resetObservabilityRuntime,
  subscribeObservability,
  type CruxGraphRecord,
} from "../../src/observability";
import {
  evalValue,
  memoryEvidenceStore,
  nonBillablePlanningPorts,
  planningPorts,
  task,
  taskResult,
} from "./reuse-test-harness";

/** Register one terminal observability root per live Eval task attempt. */
export function cellObservabilityBehavior(): void {
  describe("Eval cell observability", () => {
    afterEach(() => resetObservabilityRuntime());

    it("owns one eval.case root around each managed and opaque live attempt", async () => {
      const records: CruxGraphRecord[] = [];
      subscribeObservability((record) => records.push(record));
      const managed = observedManagedTask();
      const opaque = async () => {
        emitGenerationSpan("opaque generation");
        return "opaque";
      };

      const managedResult = await executeObservedEvalTaskForInternalUse(
        request(managed, "managed"),
      );
      const opaqueResult = await executeObservedOpaqueTaskForInternalUse(
        request(opaque, "opaque"),
      );

      const starts = records.filter(
        (record) =>
          record.type === "run:start" && record.rootPrimitive === "eval.case",
      );
      const ends = records.filter(
        (record) =>
          record.type === "run:end" &&
          starts.some((start) => start.runId === record.runId),
      );
      const generationStarts = records.filter(
        (record) =>
          record.type === "span:start" &&
          record.primitive === "generation.call",
      );

      expect(starts).toHaveLength(2);
      expect(ends).toHaveLength(2);
      expect(ends.map((record) => record.status)).toEqual(["ok", "ok"]);
      expect(generationStarts.map((record) => record.runId)).toEqual(
        starts.map((record) => record.runId),
      );
      expect(managedResult.runIds).toEqual([starts[0]?.runId]);
      expect(opaqueResult.runIds).toEqual([starts[1]?.runId]);
    });

    it("ends a generic task failure once with normalized error evidence", async () => {
      const records: CruxGraphRecord[] = [];
      subscribeObservability((record) => records.push(record));
      const failure = new Error("task failed");

      await expect(
        executeObservedOpaqueTaskForInternalUse(
          request(async () => {
            throw failure;
          }, "error"),
        ),
      ).rejects.toBe(failure);

      const root = records.find(
        (record) =>
          record.type === "run:start" && record.rootPrimitive === "eval.case",
      );
      const terminals = records.filter(
        (record) => record.type === "run:end" && record.runId === root?.runId,
      );
      expect(terminals).toEqual([
        expect.objectContaining({
          status: "error",
          error: expect.objectContaining({
            name: "Error",
            message: "task failed",
          }),
        }),
      ]);
    });

  it("does not fabricate live roots for reused or skipped cells", async () => {
    const evidenceStore = memoryEvidenceStore();
    const options = {
      sourceKey: {
        relativeFile: "support.eval.ts",
        export: "default" as const,
      },
    };
    const firstPlan = await planEval(
      evalValue(),
      options,
      planningPorts(evidenceStore),
    );
    await executeEvalPlan(firstPlan, {
      taskHost: { execute: async () => taskResult() },
      clock: { now: () => 1 },
      ids: { next: () => "first-run" },
      runStore: { write: async () => undefined },
      evidenceStore,
    });
    const records: CruxGraphRecord[] = [];
    subscribeObservability((record) => records.push(record));

    const reusePlan = await planEval(
      evalValue(),
      options,
      planningPorts(evidenceStore),
    );
    const execute = vi.fn(async () => taskResult());
    await executeEvalPlan(reusePlan, {
      taskHost: { execute },
      clock: { now: () => 2 },
      ids: { next: () => "reuse-run" },
      runStore: { write: async () => undefined },
      evidenceStore,
    });
    const skippedPlan = await planEval(
      evaluate({
        id: "skipped",
        task,
        cases: [{ id: "skip", input: {}, skip: true }],
      }),
      {
        sourceKey: {
          relativeFile: "skipped.eval.ts",
          export: "default",
        },
      },
      nonBillablePlanningPorts(),
    );
    await executeEvalPlan(skippedPlan, {
      taskHost: { execute },
      clock: { now: () => 3 },
      ids: { next: () => "skip-run" },
      runStore: { write: async () => undefined },
    });

    expect(reusePlan.cells[0]?.action.kind).toBe("reuse");
    expect(execute).not.toHaveBeenCalled();
    expect(
      records.filter(
        (record) =>
          record.type === "run:start" && record.rootPrimitive === "eval.case",
      ),
    ).toEqual([]);
  });

  it.each([
    {
      budget: "chunk" as const,
      timeout: { budget: "chunk" as const, limitMs: 750 },
      attributes: {
        evalOutcome: "timed_out",
        timeoutBudget: "chunk",
        timeoutLimitMs: 750,
      },
    },
    {
      budget: "tool" as const,
      timeout: {
        budget: "tool" as const,
        limitMs: 10_000,
        toolName: "search_docs",
      },
      attributes: {
        evalOutcome: "timed_out",
        timeoutBudget: "tool",
        timeoutLimitMs: 10_000,
        timeoutToolName: "search_docs",
      },
    },
  ])("terminalizes a local $budget timeout exactly once", async (fixture) => {
    const records: CruxGraphRecord[] = [];
    subscribeObservability((record) => records.push(record));
    const timedTask = async () => {
      throw new TimeoutError(fixture.timeout);
    };

    await expect(
      executeObservedOpaqueTaskForInternalUse(
        request(timedTask, fixture.budget),
      ),
    ).rejects.toSatisfy(TimeoutError.isInstance);

    const root = records.find(
      (record) =>
        record.type === "run:start" && record.rootPrimitive === "eval.case",
    );
    const terminals = records.filter(
      (record) => record.type === "run:end" && record.runId === root?.runId,
    );
    expect(terminals).toEqual([
      expect.objectContaining({
        status: "cancelled",
        attributes: fixture.attributes,
      }),
    ]);
    expect(terminals[0]).not.toHaveProperty("error");
    expect(Object.hasOwn(fixture.attributes, "timeoutToolName")).toBe(
      fixture.budget === "tool",
    );
  });
  });
}

function request(taskValue: unknown, caseId: string): EvalTaskHostRequest {
  return {
    evalId: "observability",
    caseId,
    variant: "current",
    trial: 0,
    task: taskValue,
    overrides: {},
    input: {},
  };
}

function observedManagedTask() {
  const descriptor = getEvalTaskDescriptorForInternalUse(task);
  return attachEvalTaskDescriptorForInternalUse(async () => undefined, {
    ...descriptor,
    execute: async (input, call, overrides, context) => {
      emitGenerationSpan("managed generation");
      return descriptor.execute(input, call, overrides, context);
    },
  });
}

function emitGenerationSpan(name: string): void {
  const span = observe.openSpan({ name, primitive: "generation.call" });
  span.end();
}
