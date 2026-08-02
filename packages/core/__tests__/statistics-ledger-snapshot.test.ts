import { describe, expect, it } from "vitest";

import {
  createMemoryStatisticsLedger,
  type StatisticsOwner,
} from "../src/statistics";

describe("statistics ledger snapshots", () => {
  it("is deeply frozen, detached, and strips unapproved content", () => {
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
      fact: { kind: "model-call", outcome: "started", model: "safe-model" },
    });
    ledger.record({
      owner,
      cursor: 2,
      at: new Date("2026-08-01T12:00:01.000Z"),
      fact,
    });

    const snapshot = ledger.snapshot(owner)!;
    expect(isDeepFrozen(snapshot)).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain("never retain me");
    expect(JSON.stringify(snapshot)).not.toContain("nor me");
    expect(JSON.stringify(ledger.export(owner))).not.toContain(
      "never retain me",
    );
    expect(() => {
      (snapshot.scope.modelCalls as { succeeded: number }).succeeded = 99;
    }).toThrow(TypeError);
    expect(ledger.snapshot(owner)?.scope.modelCalls.succeeded).toBe(1);
  });

  it("returns defensive Date reads that caller mutation cannot change", () => {
    const ledger = createMemoryStatisticsLedger();
    const owner = { kind: "work", id: "dates" } satisfies StatisticsOwner;
    const startedAt = new Date("2026-08-01T12:00:01.000Z");
    ledger.record({
      owner,
      cursor: 1,
      at: startedAt,
      fact: { kind: "model-call", outcome: "started", model: "model-a" },
    });
    startedAt.setUTCFullYear(1999);
    ledger.record({
      owner,
      cursor: 2,
      at: new Date("2026-08-01T12:00:02.000Z"),
      fact: {
        kind: "timing",
        activeTimeMs: 1_000,
        suspendedTimeMs: 0,
        completed: true,
      },
    });

    const snapshot = ledger.snapshot(owner)!;
    const expected = {
      at: snapshot.at.getTime(),
      startedAt: snapshot.scope.timing.startedAt.getTime(),
      updatedAt: snapshot.scope.timing.updatedAt.getTime(),
      completedAt: snapshot.scope.timing.completedAt!.getTime(),
    };
    snapshot.at.setTime(0);
    snapshot.scope.timing.startedAt.setTime(0);
    snapshot.scope.timing.updatedAt.setTime(0);
    snapshot.scope.timing.completedAt!.setTime(0);

    expect(snapshot.at.getTime()).toBe(expected.at);
    expect(snapshot.scope.timing.startedAt.getTime()).toBe(expected.startedAt);
    expect(snapshot.scope.timing.updatedAt.getTime()).toBe(expected.updatedAt);
    expect(snapshot.scope.timing.completedAt!.getTime()).toBe(
      expected.completedAt,
    );
    expect(snapshot.scope.timing.startedAt).not.toBe(
      snapshot.scope.timing.startedAt,
    );
    expect(ledger.snapshot(owner)).toEqual(snapshot);
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
