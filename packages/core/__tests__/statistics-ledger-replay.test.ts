import { describe, expect, it } from "vitest";

import {
  createMemoryStatisticsLedger,
  type StatisticsOwner,
  type StatisticsRecord,
} from "../src/statistics";

const owner = { kind: "flow", id: "ordered" } satisfies StatisticsOwner;

describe("statistics ledger committed ordering", () => {
  it("accepts only exact high-water replay and contiguous new records", () => {
    const ledger = createMemoryStatisticsLedger();
    const first = record(1, {
      kind: "model-call",
      outcome: "started",
      model: "model-a",
    });
    const second = record(2, {
      kind: "tool",
      outcome: "called",
      name: "search",
    });

    ledger.record(first);
    ledger.record(second);
    const accepted = ledger.snapshot(owner);

    ledger.record(second);
    expect(ledger.snapshot(owner)).toEqual(accepted);

    expect(() =>
      ledger.record({
        ...second,
        fact: { kind: "tool", outcome: "called", name: "different" },
      }),
    ).toThrow(/divergent cursor reuse/i);
    expect(() => ledger.record(first)).toThrow(/out-of-order cursor/i);
    expect(() => ledger.record(record(4, first.fact))).toThrow(/cursor gap/i);
    for (const cursor of [Number.NaN, Number.POSITIVE_INFINITY, 2.5, -1]) {
      expect(() => ledger.record(record(cursor, first.fact))).toThrow(
        /cursor/i,
      );
    }
    expect(ledger.snapshot(owner)).toEqual(accepted);

    const exported = ledger.export(owner)!;
    const restored = createMemoryStatisticsLedger();
    restored.restore(JSON.parse(JSON.stringify(exported)));
    restored.record(second);
    expect(restored.snapshot(owner)).toEqual(accepted);
    expect(restored.export(owner)).toEqual(exported);
    expect(() =>
      restored.record({
        ...second,
        at: new Date("2026-08-01T10:00:03.000Z"),
      }),
    ).toThrow(/divergent cursor reuse/i);

    const divergent = createMemoryStatisticsLedger();
    divergent.record(first);
    divergent.record({
      ...second,
      fact: { kind: "tool", outcome: "called", name: "different" },
    });
    expect(() => restored.restore(divergent.export(owner))).toThrow(
      /divergent cursor reuse/i,
    );
  });
});

function record(
  cursor: number,
  fact: StatisticsRecord["fact"],
): StatisticsRecord {
  return {
    owner,
    cursor,
    at: new Date(
      1_775_210_400_000 + (Number.isFinite(cursor) ? cursor : 0) * 1_000,
    ),
    fact,
  };
}
