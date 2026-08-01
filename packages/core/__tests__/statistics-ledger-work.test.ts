import { describe, expect, it } from "vitest";

import {
  createMemoryStatisticsLedger,
  type StatisticsFact,
  type StatisticsOwner,
} from "../src/statistics";

describe("statistics ledger logical Work", () => {
  it("counts acceptance once and validates every later gauge transition", () => {
    const ledger = createMemoryStatisticsLedger();
    const owner = { kind: "flow", id: "work" } satisfies StatisticsOwner;
    const record = (cursor: number, fact: StatisticsFact) =>
      ledger.record({
        owner,
        cursor,
        at: new Date(1_775_210_400_000 + cursor * 1_000),
        fact,
      });

    const accepted = {
      kind: "work-accepted",
      target: "writer",
      state: "queued",
    } as const;
    record(1, accepted);
    record(1, accepted);
    record(2, {
      kind: "work-state",
      target: "writer",
      from: "queued",
      to: "running",
    });
    record(3, {
      kind: "work-state",
      target: "writer",
      from: "running",
      to: "suspended",
    });
    record(4, {
      kind: "work-state",
      target: "writer",
      from: "suspended",
      to: "running",
    });
    record(5, {
      kind: "work-outcome",
      target: "writer",
      from: "running",
      outcome: "completed",
    });

    const completed = ledger.snapshot(owner);
    expect(() =>
      record(6, {
        kind: "work-state",
        target: "writer",
        from: "running",
        to: "blocked",
      }),
    ).toThrow(/gauge underflow/i);
    expect(ledger.snapshot(owner)).toEqual(completed);
    expect(() =>
      record(6, {
        kind: "work-state",
        target: "writer",
        from: "queued",
        to: "queued",
      }),
    ).toThrow(/impossible Work transition/i);
    expect(ledger.snapshot(owner)).toEqual(completed);

    record(6, { kind: "work-accepted", target: "writer", state: "blocked" });
    record(7, {
      kind: "work-outcome",
      target: "writer",
      from: "blocked",
      outcome: "detached",
    });
    const settled = ledger.snapshot(owner);
    expect(() =>
      record(8, {
        kind: "work-outcome",
        target: "unknown",
        from: "running",
        outcome: "failed",
      }),
    ).toThrow(/gauge underflow/i);
    expect(ledger.snapshot(owner)).toEqual(settled);
    expect(settled?.scope.work).toEqual({
      total: {
        started: 2,
        completed: 1,
        failed: 0,
        cancelled: 0,
        detached: 1,
        current: { queued: 0, running: 0, suspended: 0, blocked: 0 },
      },
      byTarget: {
        writer: {
          started: 2,
          completed: 1,
          failed: 0,
          cancelled: 0,
          detached: 1,
          current: { queued: 0, running: 0, suspended: 0, blocked: 0 },
        },
      },
      targetAttribution: "complete",
    });
  });
});
