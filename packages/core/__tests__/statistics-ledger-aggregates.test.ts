import { describe, expect, it } from "vitest";

import {
  createMemoryStatisticsLedger,
  type StatisticsFact,
  type StatisticsOwner,
} from "../src/statistics";

describe("statistics ledger aggregates", () => {
  it("isolates owners and accumulates approved mechanical families", () => {
    const ledger = createMemoryStatisticsLedger();
    const owner = { kind: "run", id: "alpha" } satisfies StatisticsOwner;
    const other = { kind: "run", id: "beta" } satisfies StatisticsOwner;
    const record = (cursor: number, fact: StatisticsFact) =>
      ledger.record({
        owner,
        cursor,
        at: new Date(1_775_210_400_000 + cursor * 1_000),
        fact,
      });

    record(1, { kind: "model-call", outcome: "started", model: "model-a" });
    record(2, {
      kind: "model-call",
      outcome: "succeeded",
      model: "model-a",
      usage: { inputTokens: 10, totalTokens: 10, costUsd: 0.01 },
    });
    record(3, { kind: "tool", name: "search", outcome: "called" });
    record(4, { kind: "tool", name: "search", outcome: "succeeded" });
    record(5, { kind: "work-accepted", target: "writer", state: "running" });
    record(6, {
      kind: "work-outcome",
      target: "writer",
      from: "running",
      outcome: "completed",
    });
    record(7, { kind: "failure", failureKind: "provider" });
    record(8, { kind: "approval", outcome: "requested" });
    record(9, { kind: "approval", outcome: "approved" });
    record(10, { kind: "lifecycle", event: "suspension" });
    record(11, {
      kind: "timing",
      activeTimeMs: 700,
      suspendedTimeMs: 300,
      completed: true,
    });
    ledger.record({
      owner: other,
      cursor: 1,
      at: new Date("2026-08-01T10:00:01.000Z"),
      fact: { kind: "model-call", outcome: "started", model: "model-b" },
    });

    const scope = ledger.snapshot(owner)!.scope;
    expect(scope.usage).toMatchObject({
      inputTokens: 10,
      totalTokens: 10,
      costUsd: 0.01,
      coverage: { tokens: "complete", cost: "complete" },
      byModel: {
        "model-a": {
          calls: 1,
          inputTokens: 10,
          totalTokens: 10,
          costUsd: 0.01,
          coverage: { tokens: "complete", cost: "complete" },
        },
      },
      modelAttribution: "complete",
    });
    expect(scope.modelCalls).toEqual({
      started: 1,
      succeeded: 1,
      failed: 0,
      cancelled: 0,
      transportRetries: 0,
    });
    expect(scope.tools.total).toEqual({
      called: 1,
      succeeded: 1,
      failed: 0,
      denied: 0,
      cancelled: 0,
    });
    expect(scope.work.total).toEqual({
      started: 1,
      completed: 1,
      failed: 0,
      cancelled: 0,
      detached: 0,
      current: { queued: 0, running: 0, suspended: 0, blocked: 0 },
    });
    expect(scope.failures.total).toBe(1);
    expect(scope.approvals).toEqual({
      requested: 1,
      approved: 1,
      denied: 0,
      expired: 0,
    });
    expect(scope.lifecycle.suspensions).toBe(1);
    expect(scope.timing).toMatchObject({
      wallTimeMs: 10_000,
      activeTimeMs: 700,
      suspendedTimeMs: 300,
    });
    expect(ledger.snapshot(other)?.scope.usage.byModel).toEqual({
      "model-b": {
        calls: 1,
        coverage: { tokens: "none", cost: "none" },
      },
    });
  });

  it("keeps the first 64 identities and rolls later facts into typed overflow", () => {
    const ledger = createMemoryStatisticsLedger();
    const owner = { kind: "session", id: "bounded" } satisfies StatisticsOwner;
    let cursor = 0;
    const record = (fact: StatisticsFact) => {
      cursor += 1;
      ledger.record({
        owner,
        cursor,
        at: new Date(1_800_000_000_000 + cursor),
        fact,
      });
    };

    for (let index = 0; index < 65; index += 1) {
      record({
        kind: "model-call",
        outcome: "started",
        model: `model-${index}`,
      });
      record({ kind: "tool", outcome: "called", name: `tool-${index}` });
      record({
        kind: "work-accepted",
        target: `target-${index}`,
        state: "running",
      });
    }
    record({ kind: "model-call", outcome: "started", model: "model-0" });
    record({
      kind: "model-call",
      outcome: "started",
      model: "model-overflow",
    });

    const scope = ledger.snapshot(owner)!.scope;
    expect(Object.keys(scope.usage.byModel)).toHaveLength(64);
    expect(scope.usage.byModel["model-0"]?.calls).toBe(2);
    expect(scope.usage.otherModels?.calls).toBe(2);
    expect(scope.usage.modelAttribution).toBe("truncated");
    expect(Object.keys(scope.tools.byName)).toHaveLength(64);
    expect(scope.tools.total.called).toBe(65);
    expect(scope.tools.otherNames?.called).toBe(1);
    expect(scope.tools.nameAttribution).toBe("truncated");
    expect(Object.keys(scope.work.byTarget)).toHaveLength(64);
    expect(scope.work.total.started).toBe(65);
    expect(scope.work.otherTargets?.current.running).toBe(1);
    expect(scope.work.targetAttribution).toBe("truncated");
  });
});
