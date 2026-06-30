import { describe, expect, it, vi } from "vitest";
import { inMemoryRecordStore } from "../../storage";
import { workspace } from "../../workspace";

describe("workspace listing", () => {
  it("matches globstar patterns across zero or more path segments", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });

    await ws.write("/workspace/top.md", "top");
    await ws.write("/workspace/sub/deep.md", "deep");

    const listing = await ws.list("/workspace/**/*.md");

    expect(listing.entries.map((entry) => entry.path).sort()).toEqual([
      "/workspace/sub/deep.md",
      "/workspace/top.md",
    ]);
  });

  it("pushes list limits into the data store", async () => {
    const data = inMemoryRecordStore();
    const listSpy = vi.spyOn(data, "list");
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: data,
    });

    for (let index = 0; index < 50; index += 1) {
      await ws.write(`/workspace/file-${index}.md`, `file ${index}`);
    }

    const listing = await ws.list("/workspace", { limit: 10 });

    expect(listing.entries.length).toBeLessThanOrEqual(10);
    expect(listSpy).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ limit: 10 }),
    );
  });

  it("keeps fetching pages until filtered directory entries satisfy the limit", async () => {
    const data = inMemoryRecordStore();
    const listSpy = vi.spyOn(data, "list");
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: data,
    });

    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000);
      await ws.write("/workspace/one.md", "one");
      await ws.write("/workspace/two.md", "two");
      vi.setSystemTime(2_000);
      await ws.write("/outputs/newer-a.md", "newer");
      await ws.write("/outputs/newer-b.md", "newer");

      const listing = await ws.list("/workspace", { limit: 2 });

      expect(listing.entries.map((entry) => entry.path).sort()).toEqual([
        "/workspace/one.md",
        "/workspace/two.md",
      ]);
      expect(listSpy).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
