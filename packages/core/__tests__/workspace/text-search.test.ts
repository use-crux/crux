import { describe, expect, it } from "vitest";
import { inMemoryRecordStore } from "../../src/storage";
import { workspace } from "../../src/workspace";

describe("workspace text search", () => {
  it("rejects overly long regex queries before searching", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });

    await expect(
      ws.grep("a".repeat(257), { regex: true }),
    ).rejects.toThrow(/regex query is too long/i);
  });

  it("rejects obviously complex regex queries before searching", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });

    await expect(ws.grep("(a+)+$", { regex: true })).rejects.toThrow(
      /regex query is too complex/i,
    );
  });
});
