import { expect, it } from "vitest";

import { evalContext } from "../../src/eval";
import { evaluate } from "../../src/eval/evaluate";
import { executeEvalPlan } from "../../src/eval/internal/executor";
import { planEval } from "../../src/eval/internal/planner";
import {
  createInMemoryObservabilityTransport,
  observe,
  setObservabilityTransport,
} from "../../src/observability";
import { createDeadlineClock } from "./deadline-clock.fixture";
import { nonBillablePlanningPorts } from "./reuse-test-harness";

/** Register late-write quarantine behavior against the real cell deadline. */
export function defineTimeoutDeferBehavior(): void {
  it("drops observability emitted synchronously by an abort listener", async () => {
    const deadlineClock = createDeadlineClock();
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const task = async () => {
      evalContext().signal.addEventListener(
        "abort",
        () => {
          void observe.run(
            { name: "late timeout write", rootPrimitive: "custom.operation" },
            async () => undefined,
          );
        },
        { once: true },
      );
      markStarted?.();
      await new Promise<never>(() => undefined);
    };
    const evalValue = evaluate({
      id: "timeout-write-quarantine",
      task,
      timeout: { totalMs: 100 },
      cases: [{ id: "slow", input: undefined }],
    });
    const plan = await planEval(
      evalValue,
      {
        sourceKey: {
          relativeFile: "timeout-write-quarantine.eval.ts",
          export: "default",
        },
      },
      nonBillablePlanningPorts(),
    );
    const execution = executeEvalPlan(plan, {
      taskHost: {
        execute: async ({ task: taskValue }) => ({
          output: await (taskValue as typeof task)(),
          capturedSignals: [],
          runIds: [],
          metrics: { durationMs: 0 },
        }),
      },
      clock: { now: deadlineClock.now },
      cellDeadlineClock: deadlineClock,
      ids: { next: () => "run-timeout" },
      runStore: { write: async () => undefined },
    });

    await started;
    deadlineClock.advance(100);
    await execution;
    await observe.flush();

    expect(
      transport.records.some(
        (record) =>
          record.type === "run:start" && record.name === "late timeout write",
      ),
    ).toBe(false);
  });
}
