import type { SearchStore } from "../types";

/** Options for {@link describeSearchStoreConformance}. */
export interface DescribeSearchStoreConformanceOptions {
  readonly name: string;
  readonly prepare: () => SearchStore | Promise<SearchStore>;
}

/** Register shared behavior checks for beta `SearchStore` adapters. */
export function describeSearchStoreConformance(
  options: DescribeSearchStoreConformanceOptions,
  api: Pick<typeof import("vitest"), "describe" | "expect" | "it">,
): void {
  const { describe, expect, it } = api;
  describe(`${options.name} SearchStore conformance`, () => {
    it("derives capabilities and rejects unsupported legs", async () => {
      const search = await options.prepare();
      const capabilities = search.capabilities();
      expect(capabilities.legs).toEqual(expect.objectContaining({ dense: true, sparse: true, lexical: false }));
      expect(capabilities.fusion).toContain("rrf");
      await expect(search.search({ legs: [{ kind: "lexical", query: "alpha" }] })).rejects.toMatchObject({
        code: "unsupported_capability",
      });
    });

    it("validates records and queries before search", async () => {
      const search = await options.prepare();
      await expect(search.upsert([{ key: "bad:dense", dense: [1, Number.NaN] }])).rejects.toMatchObject({
        code: "invalid_value",
      });
      await expect(search.upsert([{ key: "bad:sparse", sparse: { indices: [0, 0], values: [1, 2] } }])).rejects.toMatchObject({
        code: "invalid_value",
      });
      await expect(search.search({ legs: [] as unknown as Parameters<SearchStore["search"]>[0]["legs"] })).rejects.toMatchObject({
        code: "invalid_value",
      });
      await expect(search.search({ legs: [{ kind: "dense", vector: [] }] })).rejects.toMatchObject({
        code: "invalid_value",
      });
      await expect(search.search({ legs: [{ kind: "dense", vector: [1] }], threshold: Number.NaN })).rejects.toMatchObject({
        code: "invalid_value",
      });
    });

    it("applies exact pre-filters, deletes, and full-record replacement", async () => {
      const search = await options.prepare();
      await search.upsert([
        { key: "search:match", dense: [1, 0], sparse: { indices: [1], values: [1] }, metadata: { namespace: "a" } },
        { key: "search:other", dense: [1, 0], metadata: { namespace: "b" } },
      ]);
      await expect(search.search({
        legs: [{ kind: "dense", vector: [1, 0] }],
        filter: { namespace: "a" },
      })).resolves.toEqual([expect.objectContaining({ key: "search:match" })]);
      await search.upsert([{ key: "search:match", sparse: { indices: [2], values: [1] }, metadata: { namespace: "a" } }]);
      await expect(search.search({ legs: [{ kind: "dense", vector: [1, 0] }], filter: { namespace: "a" } })).resolves.toEqual([]);
      await expect(search.search({ legs: [{ kind: "sparse", vector: { indices: [2], values: [1] } }], filter: { namespace: "a" } })).resolves.toEqual([
        expect.objectContaining({ key: "search:match" }),
      ]);
      await search.delete(["search:match"]);
      await expect(search.search({ legs: [{ kind: "sparse", vector: { indices: [2], values: [1] } }], filter: { namespace: "a" } })).resolves.toEqual([]);
    });

    it("short-circuits zero limits and enforces candidate bounds", async () => {
      const search = await options.prepare();
      await search.upsert([{ key: "search:zero", dense: [1, 0] }]);
      await expect(search.search({ legs: [{ kind: "dense", vector: [1, 0] }], limit: 0 })).resolves.toEqual([]);
      await expect(search.search({
        legs: [{ kind: "dense", vector: [1, 0], candidates: 1 }],
        limit: 2,
      })).rejects.toMatchObject({ code: "invalid_value" });
    });

    it("uses normalized deterministic RRF with matches and >= thresholds", async () => {
      const search = await options.prepare();
      await search.upsert([
        { key: "a", dense: [1, 0], sparse: { indices: [1], values: [0.2] } },
        { key: "b", dense: [0.9, 0.1], sparse: { indices: [1], values: [1] } },
        { key: "c", dense: [0.9, 0.1], sparse: { indices: [2], values: [1] } },
      ]);
      const hits = await search.search({
        legs: [
          { kind: "dense", vector: [1, 0], candidates: 3 },
          { kind: "sparse", vector: { indices: [1], values: [1] }, candidates: 3 },
        ],
        fusion: { strategy: "rrf", k: 60 },
        limit: 3,
        threshold: 0,
      });
      expect(hits.map((hit) => hit.key)).toEqual(["a", "b", "c"]);
      expect(hits[0]?.matches.map((match) => match.kind)).toEqual(["dense", "sparse"]);
      expect(hits[0]?.score).toBeGreaterThanOrEqual(0);
      expect(hits[0]?.score).toBeLessThanOrEqual(1);
      await expect(search.search({
        legs: [{ kind: "dense", vector: [1, 0] }],
        threshold: hits.find((hit) => hit.key === "a")!.matches[0]!.score,
      })).resolves.toContainEqual(expect.objectContaining({ key: "a" }));
    });
  });
}
