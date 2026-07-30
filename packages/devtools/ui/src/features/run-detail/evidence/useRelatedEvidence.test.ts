import { describe, expect, it, vi } from "vitest";
import { chunk, loadRelatedEvidence } from "./useRelatedEvidence";

describe("Related Evidence complete batch loading", () => {
  it("chunks Local requests at one hundred subjects", () => {
    expect(chunk(Array.from({ length: 201 }), 100).map((part) => part.length))
      .toEqual([100, 100, 1]);
  });

  it("rejects the whole projection when any chunk fails", async () => {
    const root = {
      id: "root",
      name: "Root",
      children: Array.from({ length: 101 }, (_, index) => ({
        id: `span_${index}`,
        name: `Span ${index}`,
        children: [],
      })),
    };
    const fetcher = vi.fn(async (subjects: readonly unknown[]) => {
      if (subjects.length === 1) throw new Error("second chunk failed");
      return {
        results: subjects.map((_, index) => ({
          subject: { kind: "execution" as const, id: `span_${index}` },
          status: "available" as const,
          totalActiveRecordCount: 1,
        })),
      };
    });

    await expect(
      loadRelatedEvidence(
        { root, selectedId: "root", limit: 8 },
        undefined,
        fetcher,
      ),
    ).rejects.toThrow("second chunk failed");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not fall back to the root for an unknown selection", async () => {
    const fetcher = vi.fn();
    await expect(
      loadRelatedEvidence(
        {
          root: {
            id: "root",
            name: "Root",
            children: [
              { id: "span_child", name: "Child", children: [] },
            ],
          },
          selectedId: "missing",
          limit: 8,
        },
        undefined,
        fetcher,
      ),
    ).resolves.toEqual({ total: 0, showing: 0, rows: [] });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
