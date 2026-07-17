import { describe, expect, it } from "vitest";
import { orderRunDetailChildren } from "./run-detail-order";

describe("run-detail ordering", () => {
  it("orders same-millisecond siblings by seq when present", () => {
    const ordered = orderRunDetailChildren([
      child("span-c", "2026-07-03T10:00:00.000Z", 30),
      child("span-a", "2026-07-03T10:00:00.000Z", 10),
      child("span-b", "2026-07-03T10:00:00.000Z", 20),
    ]);

    expect(ordered.map((node) => node.id)).toEqual([
      "span-a",
      "span-b",
      "span-c",
    ]);
  });
});

function child(id: string, startedAt: string, seq: number) {
  return {
    id,
    timing: { startedAt },
    startedAt,
    seq,
  };
}
