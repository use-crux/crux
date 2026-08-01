import { describe, expect, it } from "vitest";

import {
  createMemoryStatisticsLedger,
  type StatisticsFact,
  type StatisticsOwner,
  type StatisticsRecord,
} from "../src";

describe("statistics ledger", () => {
  it("isolates committed aggregates by owner", () => {
    const ledger = createMemoryStatisticsLedger();
    const alpha = { kind: "flow", id: "alpha" } satisfies StatisticsOwner;
    const beta = { kind: "flow", id: "beta" } satisfies StatisticsOwner;

    ledger.record({
      owner: alpha,
      cursor: 1,
      at: new Date("2026-08-01T10:00:00.000Z"),
      fact: { kind: "model-call", outcome: "started", model: "model-a" },
    });
    ledger.record({
      owner: beta,
      cursor: 1,
      at: new Date("2026-08-01T10:00:01.000Z"),
      fact: { kind: "model-call", outcome: "started", model: "model-b" },
    });

    expect(ledger.snapshot(alpha)?.scope.modelCalls.started).toBe(1);
    expect(ledger.snapshot(alpha)?.scope.usage.byModel).toEqual({
      "model-a": {
        calls: 1,
        coverage: { tokens: "none", cost: "none" },
      },
    });
    expect(ledger.snapshot(beta)?.scope.usage.byModel).toEqual({
      "model-b": {
        calls: 1,
        coverage: { tokens: "none", cost: "none" },
      },
    });
  });

  it("aggregates the approved mechanical statistics with honest usage coverage", () => {
    const ledger = createMemoryStatisticsLedger();
    const owner = { kind: "run", id: "run-1" } satisfies StatisticsOwner;
    const at = (second: number) =>
      new Date(`2026-08-01T10:00:${String(second).padStart(2, "0")}.000Z`);
    const record = (cursor: number, fact: StatisticsFact) =>
      ledger.record({ owner, cursor, at: at(cursor), fact });

    record(1, { kind: "model-call", outcome: "started", model: "model-a" });
    record(2, {
      kind: "model-call",
      outcome: "succeeded",
      model: "model-a",
      usage: {
        inputTokens: 10,
        outputTokens: 4,
        totalTokens: 14,
        cachedInputTokens: 3,
        reasoningTokens: 2,
        costUsd: 0.01,
      },
    });
    record(3, { kind: "transport-retry" });
    record(4, { kind: "tool", name: "search", outcome: "called" });
    record(5, { kind: "tool", name: "search", outcome: "succeeded" });
    record(6, {
      kind: "work",
      target: "writer",
      outcome: "started",
      current: { to: "running" },
    });
    record(7, {
      kind: "work",
      target: "writer",
      outcome: "completed",
      current: { from: "running" },
    });
    record(8, { kind: "failure", failureKind: "provider" });
    record(9, { kind: "approval", outcome: "requested" });
    record(10, { kind: "approval", outcome: "approved" });
    record(11, { kind: "lifecycle", event: "suspension" });
    record(12, {
      kind: "timing",
      activeTimeMs: 700,
      suspendedTimeMs: 300,
      completed: true,
    });

    expect(ledger.snapshot(owner)?.scope).toEqual({
      usage: {
        inputTokens: 10,
        outputTokens: 4,
        totalTokens: 14,
        cachedInputTokens: 3,
        reasoningTokens: 2,
        costUsd: 0.01,
        coverage: { tokens: "complete", cost: "complete" },
        byModel: {
          "model-a": {
            calls: 1,
            inputTokens: 10,
            outputTokens: 4,
            totalTokens: 14,
            cachedInputTokens: 3,
            reasoningTokens: 2,
            costUsd: 0.01,
            coverage: { tokens: "complete", cost: "complete" },
          },
        },
        modelAttribution: "complete",
      },
      timing: {
        startedAt: at(1),
        updatedAt: at(12),
        completedAt: at(12),
        wallTimeMs: 11_000,
        activeTimeMs: 700,
        suspendedTimeMs: 300,
      },
      modelCalls: {
        started: 1,
        succeeded: 1,
        failed: 0,
        cancelled: 0,
        transportRetries: 1,
      },
      tools: {
        total: { called: 1, succeeded: 1, failed: 0, denied: 0, cancelled: 0 },
        byName: {
          search: {
            called: 1,
            succeeded: 1,
            failed: 0,
            denied: 0,
            cancelled: 0,
          },
        },
        nameAttribution: "complete",
      },
      work: {
        total: {
          started: 1,
          completed: 1,
          failed: 0,
          cancelled: 0,
          detached: 0,
          current: { queued: 0, running: 0, suspended: 0, blocked: 0 },
        },
        byTarget: {
          writer: {
            started: 1,
            completed: 1,
            failed: 0,
            cancelled: 0,
            detached: 0,
            current: { queued: 0, running: 0, suspended: 0, blocked: 0 },
          },
        },
        targetAttribution: "complete",
      },
      failures: {
        total: 1,
        byKind: {
          provider: 1,
          tool: 0,
          work: 0,
          approval: 0,
          safety: 0,
          validation: 0,
          preparation: 0,
          timeout: 0,
          runtime: 0,
          unknown: 0,
        },
      },
      approvals: { requested: 1, approved: 1, denied: 0, expired: 0 },
      lifecycle: {
        suspensions: 1,
        resumptions: 0,
        cancellations: 0,
        steeringInputs: 0,
      },
    });
  });

  it("bounds identity attribution to the first 64 committed identities", () => {
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
        kind: "work",
        outcome: "started",
        target: `target-${index}`,
        current: { to: "running" },
      });
    }
    record({ kind: "model-call", outcome: "started", model: "model-0" });
    record({ kind: "model-call", outcome: "started", model: "model-overflow" });

    const scope = ledger.snapshot(owner)!.scope;
    expect(Object.keys(scope.usage.byModel)).toHaveLength(64);
    expect(scope.usage.byModel["model-0"]?.calls).toBe(2);
    expect(scope.usage.byModel["model-64"]).toBeUndefined();
    expect(scope.usage.otherModels?.calls).toBe(2);
    expect(scope.usage.modelAttribution).toBe("truncated");

    expect(Object.keys(scope.tools.byName)).toHaveLength(64);
    expect(scope.tools.total.called).toBe(65);
    expect(scope.tools.otherNames).toEqual({
      called: 1,
      succeeded: 0,
      failed: 0,
      denied: 0,
      cancelled: 0,
    });
    expect(scope.tools.nameAttribution).toBe("truncated");

    expect(Object.keys(scope.work.byTarget)).toHaveLength(64);
    expect(scope.work.total.started).toBe(65);
    expect(scope.work.otherTargets).toEqual({
      started: 1,
      completed: 0,
      failed: 0,
      cancelled: 0,
      detached: 0,
      current: { queued: 0, running: 1, suspended: 0, blocked: 0 },
    });
    expect(scope.work.targetAttribution).toBe("truncated");
  });

  it("returns detached, deeply frozen, content-free snapshots", () => {
    const ledger = createMemoryStatisticsLedger();
    const owner = { kind: "work", id: "safe" } satisfies StatisticsOwner;
    const usage = Object.assign(
      { inputTokens: 2 },
      { prompt: "never retain me" },
    );
    const fact = Object.assign(
      {
        kind: "model-call" as const,
        outcome: "succeeded" as const,
        model: "safe-model",
        usage,
      },
      { output: "nor me" },
    );
    ledger.record({
      owner,
      cursor: 1,
      at: new Date("2026-08-01T12:00:00.000Z"),
      fact,
    });

    const snapshot = ledger.snapshot(owner)!;
    expect(isDeepFrozen(snapshot)).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain("never retain me");
    expect(JSON.stringify(snapshot)).not.toContain("nor me");
    expect(JSON.stringify(ledger.export(owner))).not.toContain("never retain me");
    expect(JSON.stringify(ledger.export(owner))).not.toContain("nor me");
    expect(() => {
      (snapshot.scope.modelCalls as { succeeded: number }).succeeded = 99;
    }).toThrow(TypeError);
    expect(ledger.snapshot(owner)?.scope.modelCalls.succeeded).toBe(1);
  });

  it("ignores redelivery while keeping Work gauges and outcomes correct", () => {
    const ledger = createMemoryStatisticsLedger();
    const owner = { kind: "flow", id: "replay" } satisfies StatisticsOwner;
    const records = [
      {
        owner,
        cursor: 1,
        at: new Date("2026-08-01T13:00:01.000Z"),
        fact: {
          kind: "work",
          target: "child",
          outcome: "started",
          current: { to: "running" },
        },
      },
      {
        owner,
        cursor: 2,
        at: new Date("2026-08-01T13:00:02.000Z"),
        fact: {
          kind: "work-state",
          target: "child",
          from: "running",
          to: "suspended",
        },
      },
      {
        owner,
        cursor: 3,
        at: new Date("2026-08-01T13:00:03.000Z"),
        fact: {
          kind: "work-state",
          target: "child",
          from: "suspended",
          to: "running",
        },
      },
      {
        owner,
        cursor: 4,
        at: new Date("2026-08-01T13:00:04.000Z"),
        fact: {
          kind: "work",
          target: "child",
          outcome: "completed",
          current: { from: "running" },
        },
      },
    ] as const satisfies readonly StatisticsRecord[];

    for (const record of records) {
      ledger.record(record);
      ledger.record(record);
    }
    ledger.record(records[0]);

    expect(ledger.snapshot(owner)?.scope.work).toEqual({
      total: {
        started: 1,
        completed: 1,
        failed: 0,
        cancelled: 0,
        detached: 0,
        current: { queued: 0, running: 0, suspended: 0, blocked: 0 },
      },
      byTarget: {
        child: {
          started: 1,
          completed: 1,
          failed: 0,
          cancelled: 0,
          detached: 0,
          current: { queued: 0, running: 0, suspended: 0, blocked: 0 },
        },
      },
      targetAttribution: "complete",
    });
    expect(ledger.snapshot(owner)?.cursor).toBe(4);
  });

  it("exports and restores restart-safe owner state without a Core store", () => {
    const ledger = createMemoryStatisticsLedger();
    const owner = { kind: "session", id: "durable" } satisfies StatisticsOwner;
    for (let index = 0; index < 65; index += 1) {
      ledger.record({
        owner,
        cursor: index + 1,
        at: new Date(1_900_000_000_000 + index),
        fact: {
          kind: "model-call",
          outcome: "started",
          model: `model-${index}`,
        },
      });
    }

    const exported = ledger.export(owner)!;
    const persisted = JSON.stringify(exported);
    const restored = createMemoryStatisticsLedger();
    restored.restore(JSON.parse(persisted));

    expect(restored.snapshot(owner)).toEqual(ledger.snapshot(owner));

    restored.record({
      owner,
      cursor: 65,
      at: new Date(1_900_000_000_064),
      fact: { kind: "model-call", outcome: "started", model: "model-64" },
    });
    restored.record({
      owner,
      cursor: 66,
      at: new Date(1_900_000_000_065),
      fact: { kind: "model-call", outcome: "started", model: "model-0" },
    });
    restored.record({
      owner,
      cursor: 67,
      at: new Date(1_900_000_000_066),
      fact: { kind: "model-call", outcome: "started", model: "new-overflow" },
    });

    const usage = restored.snapshot(owner)!.scope.usage;
    expect(usage.byModel["model-0"]?.calls).toBe(2);
    expect(usage.byModel["new-overflow"]).toBeUndefined();
    expect(usage.otherModels?.calls).toBe(2);
    expect(restored.snapshot(owner)?.cursor).toBe(67);
  });
});

function isDeepFrozen(value: unknown, seen = new Set<object>()): boolean {
  if (!value || typeof value !== "object" || seen.has(value)) return true;
  seen.add(value);
  return (
    Object.isFrozen(value) &&
    Object.values(value).every((child) => isDeepFrozen(child, seen))
  );
}
