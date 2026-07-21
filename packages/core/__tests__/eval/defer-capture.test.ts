import { afterEach, describe, expect, it, vi } from "vitest";

import { defer } from "../../src/defer";
import {
  scheduleDiagnosticsOnlyDeferredCallback,
  type DiagnosticsOnlyDeferredWorkHandle,
} from "../../src/defer/internal/port";
import type { DeferredWorkRef } from "../../src/defer/types";
import { evaluate } from "../../src/eval/evaluate";
import { executeEvalPlan } from "../../src/eval/internal/executor";
import { planEval } from "../../src/eval/internal/planner";
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "../../src/observability";
import { currentScopeStack } from "../../src/scope/internal";
import { runScope } from "../../src/scope/internal";
import { durableTask } from "../../src/runtime/api/task";
import { createTestRuntime } from "../../src/runtime/testing";
import { getHooks, setHooks } from "../../src/runtime/runtime";
import {
  openEvalCellScope,
  runEvalCellScope,
  runEvalScope,
} from "../../src/eval/internal/scope";
import { nonBillablePlanningPorts } from "./reuse-test-harness";

const previousHooks = getHooks();

afterEach(() => {
  resetObservabilityRuntime();
  setHooks(previousHooks);
});

describe("Eval defer capture", () => {
  it("reports captured diagnostics-only work without invoking it", async () => {
    const callback = vi.fn();
    let scheduled: DiagnosticsOnlyDeferredWorkHandle | undefined;

    await runEvalScope("diagnostics-capture", () =>
      runEvalCellScope(
        { caseId: "diagnostics", variant: "current", trial: 0 },
        () => {
          scheduled = scheduleDiagnosticsOnlyDeferredCallback(callback);
        },
      ),
    );

    expect(scheduled?.status).toBe("captured");
    await expect(scheduled?.settled).resolves.toBeUndefined();
    expect(callback).not.toHaveBeenCalled();
  });

  it("captures inline defer evidence at the cell boundary without invoking it", async () => {
    const callback = vi.fn();
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const plan = await createSingleCellPlan();

    const run = await executeEvalPlan(plan, {
      taskHost: {
        async execute() {
          expect(currentScopeStack().map(({ kind }) => kind)).toEqual([
            "eval-cell",
            "eval-run",
          ]);
          defer(callback);
          return {
            output: "captured",
            capturedSignals: [],
            runIds: [],
            metrics: { durationMs: 1 },
          };
        },
      },
      clock: { now: () => 1 },
      ids: { next: () => "eval-run-1" },
      runStore: { write: async () => undefined },
    });
    await observe.flush();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(run.cells[0]).toMatchObject({ status: "passed" });
    expect(callback).not.toHaveBeenCalled();
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: "span:start",
        primitive: "defer.scheduled",
        attributes: expect.objectContaining({
          mode: "inline-captured",
          sequence: 0,
          scopeKind: "eval-cell",
          scopeName: "only:current:0",
        }),
      }),
    );
  });

  it("captures named defer before Runtime staging or commit", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const target = durableTask("captured-follow-up", {
      run: async (input: { readonly id: string }) => input.id,
    });
    const runtime = createTestRuntime({ targets: [target] });
    const acceptedInput = { id: "before-mutation" };
    let reference: DeferredWorkRef | undefined;

    try {
      const plan = await createSingleCellPlan();
      const run = await executeEvalPlan(plan, {
        taskHost: {
          async execute() {
            reference = await defer(target, acceptedInput);
            acceptedInput.id = "after-mutation";
            return {
              output: "captured",
              capturedSignals: [],
              runIds: [],
              metrics: { durationMs: 1 },
            };
          },
        },
        clock: { now: () => 1 },
        ids: { next: () => "eval-run-1" },
        runStore: { write: async () => undefined },
      });
      await observe.flush();

      expect(run.cells[0]).toMatchObject({ status: "passed" });
      expect(reference).toEqual({
        kind: "deferred.work",
        workId: expect.stringMatching(/^captured:/u),
        targetId: "captured-follow-up",
      });
      expect(Object.isFrozen(reference)).toBe(true);
      await expect(
        runtime.store.deferred.listScopes({ namespace: "local" }),
      ).resolves.toEqual([]);
      await expect(
        runtime.store.outbox.list({ namespace: "local" }),
      ).resolves.toEqual([]);
      expect(transport.records).toContainEqual(
        expect.objectContaining({
          type: "span:start",
          primitive: "defer.scheduled",
          attributes: expect.objectContaining({
            mode: "named-captured",
            targetId: "captured-follow-up",
            input: { id: "before-mutation" },
            scopeKind: "eval-cell",
            scopeName: "only:current:0",
          }),
        }),
      );
    } finally {
      runtime.dispose();
    }
  });

  it("captures named defer without resolving a Runtime", async () => {
    setHooks({});
    const target = durableTask("runtime-free-capture", {
      run: async (input: { readonly id: string }) => input.id,
    });
    let reference: DeferredWorkRef | undefined;
    const plan = await createSingleCellPlan();

    const run = await executeEvalPlan(plan, {
      taskHost: {
        async execute() {
          reference = await defer(target, { id: "captured" });
          return {
            output: "captured",
            capturedSignals: [],
            runIds: [],
            metrics: { durationMs: 1 },
          };
        },
      },
      clock: { now: () => 1 },
      ids: { next: () => "eval-run-1" },
      runStore: { write: async () => undefined },
    });

    expect(run.cells[0]).toMatchObject({ status: "passed" });
    expect(reference?.workId).toMatch(/^captured:/u);
  });

  it("does not leak capture policy to work outside the Eval cell", async () => {
    const capturedCallback = vi.fn();
    await runEvalScope("capture-isolation", () =>
      runEvalCellScope({ caseId: "inside", variant: "current", trial: 0 }, () =>
        defer(capturedCallback),
      ),
    );

    let resolveDrained: (() => void) | undefined;
    const drained = new Promise<void>((resolve) => {
      resolveDrained = resolve;
    });
    await runScope({ kind: "tool", name: "outside-eval" }, {}, () => {
      defer(() => resolveDrained?.());
    });
    await drained;

    expect(capturedCallback).not.toHaveBeenCalled();
  });

  it("drops observability restored into a timed-out cell only", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);

    await runEvalScope("timeout-isolation", async () => {
      const cell = openEvalCellScope({
        caseId: "expired",
        variant: "current",
        trial: 0,
      });
      cell.seal("timeout");
      await cell.run(() =>
        observe.run(
          { name: "late timed-out write", rootPrimitive: "custom.operation" },
          async () => undefined,
        ),
      );
    });
    await observe.run(
      { name: "outside write", rootPrimitive: "custom.operation" },
      async () => undefined,
    );
    await observe.flush();

    expect(
      transport.records.some(
        (record) =>
          record.type === "run:start" && record.name === "late timed-out write",
      ),
    ).toBe(false);
    expect(transport.records).toContainEqual(
      expect.objectContaining({ type: "run:start", name: "outside write" }),
    );
  });
});

async function createSingleCellPlan() {
  const value = evaluate({
    id: "defer-capture",
    task: async (input: string) => input,
    cases: [{ id: "only", input: "captured" }],
  });
  return planEval(
    value,
    {
      sourceKey: { relativeFile: "defer-capture.eval.ts", export: "default" },
    },
    nonBillablePlanningPorts(),
  );
}
