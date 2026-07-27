import { expect, it, vi } from "vitest";

import { executeEvalPlan } from "../../../src/eval/internal/executor";
import { buildEvalBaseline } from "../../../src/eval/internal/baseline-promotion";
import { planEval } from "../../../src/eval/internal/planner";
import { createNodeEvalHostRuntime } from "../../../src/eval/node/host/readiness";
import { createMemoryEvalHost } from "../../../src/runtime/eval-host";
import {
  subscribeObservability,
  type CruxGraphRecord,
} from "../../../src/observability";
import { nonBillablePlanningPorts } from "../reuse-test-harness";
import { connectionEnvironment, hydratedEntry, registry } from "./fixture";

/** Register remote timeout parity through the portable Run V4 boundary. */
export function defineRemoteRunV4Behavior(): void {
  it("persists and promotes a remote timeout with local Run V4 semantics", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let started!: () => void;
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    const ignored = new Promise<never>(() => undefined);
    const records: CruxGraphRecord[] = [];
    const unsubscribe = subscribeObservability((record) =>
      records.push(record),
    );
    const entry = hydratedEntry({
      timeout: { totalMs: 25 },
      execute: async () => {
        started();
        return await ignored;
      },
    });
    const host = createMemoryEvalHost({
      deploymentId: "production",
      token: "top-secret-token-that-is-at-least-32-bytes",
      hostCapabilities: ["record-store"],
      registry: registry(entry),
      now: () => new Date(Date.now()),
    });
    const runtime = createNodeEvalHostRuntime({
      entry,
      projectRoot: "/does-not-read-files",
      processEnvironment: {
        ...connectionEnvironment(),
        CRUX_EVAL_HOST_TOKEN: "top-secret-token-that-is-at-least-32-bytes",
      },
      transport: (request) => host.fetch(request),
    });
    const plan = await planEval(
      entry.eval,
      {
        sourceKey: entry.sourceKey,
        definitionFingerprint: entry.definitionFingerprint,
      },
      {
        ...nonBillablePlanningPorts(),
        hostReadiness: runtime.readiness,
      },
    );
    const writes: unknown[] = [];
    const pending = executeEvalPlan(plan, {
      taskHost: runtime,
      clock: { now: Date.now },
      ids: { next: () => "remote-timeout-run" },
      runStore: { write: async (run) => void writes.push(run) },
    });

    await running;
    await vi.advanceTimersByTimeAsync(25);
    const run = await pending;

    expect(writes).toEqual([run]);
    expect(run).toMatchObject({
      schemaVersion: 4,
      status: "complete",
      passed: false,
      cells: [
        {
          status: "timed_out",
          task: { status: "timed_out" },
          timeout: { budget: "total", limitMs: 25 },
          scores: [],
        },
      ],
      aggregates: {
        current: {
          cells: 1,
          timedOut: 1,
          errored: 0,
        },
      },
    });
    expect(JSON.stringify(run)).not.toContain("in_flight");
    const root = records.find(
      (record) =>
        record.type === "run:start" && record.rootPrimitive === "eval.case",
    );
    expect(
      records.filter(
        (record) => record.type === "run:end" && record.runId === root?.runId,
      ),
    ).toEqual([
      expect.objectContaining({
        status: "cancelled",
        attributes: {
          evalOutcome: "timed_out",
          timeoutBudget: "total",
          timeoutLimitMs: 25,
        },
      }),
    ]);
    expect(
      buildEvalBaseline(run, {
        baselineId: "remote-timeout-baseline",
        promotedAt: 25,
        toolVersion: "test",
      }),
    ).toMatchObject({
      coverage: [
        {
          outcomes: [{ trial: 0, status: "timed_out" }],
          metrics: {},
        },
      ],
    });
    unsubscribe();
    vi.useRealTimers();
  });
}
