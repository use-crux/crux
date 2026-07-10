import { describe, expect, it } from "vitest";
import type { VectorStore } from "../types";

/** Options for {@link describeVectorStoreConformance}. */
export interface DescribeVectorStoreConformanceOptions {
  /** Human-readable adapter name used for the Vitest `describe()` block. */
  readonly name: string;
  /** Create a fresh, isolated vector store for each conformance test. */
  readonly prepare: () => VectorStore | Promise<VectorStore>;
}

/** Register shared behavior checks for beta `VectorStore` adapters. */
export function describeVectorStoreConformance(
  options: DescribeVectorStoreConformanceOptions,
): void {
  describe(`${options.name} VectorStore conformance`, () => {
    it("validates vector input and exact metadata filters with storage errors", async () => {
      const vectors = await options.prepare();

      await expect(
        vectors.upsert([{ key: "bad:dense", dense: [1, Number.NaN] }]),
      ).rejects.toMatchObject({
        code: "invalid_value",
      });
      await expect(
        vectors.upsert([
          { key: "bad:sparse", sparse: { indices: [0, 0], values: [1, 2] } },
        ]),
      ).rejects.toMatchObject({ code: "invalid_value" });
      await expect(
        vectors.search({ mode: "dense", dense: [] }),
      ).rejects.toMatchObject({ code: "invalid_value" });
      await expect(
        vectors.search({
          mode: "dense",
          dense: [1],
          filter: { nested: {} } as never,
        }),
      ).rejects.toMatchObject({
        code: "invalid_filter",
      });
    });

    it("searches dense vectors with threshold, limit, delete, and exact pre-filters", async () => {
      const vectors = await options.prepare();
      await vectors.upsert([
        {
          key: "vector:match",
          dense: [1, 0],
          metadata: { namespace: "a", block: "facts" },
        },
        { key: "vector:missing-metadata", dense: [1, 0] },
        {
          key: "vector:wrong-filter",
          dense: [1, 0],
          metadata: { namespace: "b", block: "facts" },
        },
        {
          key: "vector:below-threshold",
          dense: [0, 1],
          metadata: { namespace: "a", block: "facts" },
        },
      ]);

      await expect(
        vectors.search({
          mode: "dense",
          dense: [1, 0],
          limit: 1,
          threshold: 0.8,
          filter: { namespace: "a", block: "facts" },
        }),
      ).resolves.toEqual([
        expect.objectContaining({
          key: "vector:match",
          metadata: { namespace: "a", block: "facts" },
        }),
      ]);

      await vectors.delete(["vector:match"]);
      await expect(
        vectors.search({
          mode: "dense",
          dense: [1, 0],
          threshold: 0.8,
          filter: { namespace: "a" },
        }),
      ).resolves.toEqual([]);
    });

    it("honors sparse, hybrid, and fusion capability claims", async () => {
      const vectors = await options.prepare();
      const capabilities = vectors.capabilities();

      if (capabilities.sparse) {
        await vectors.upsert([
          {
            key: "vector:sparse",
            sparse: { indices: [3], values: [2] },
            metadata: { namespace: "sparse" },
          },
        ]);
        await expect(
          vectors.search({
            mode: "sparse",
            sparse: { indices: [3], values: [1] },
          }),
        ).resolves.toEqual([expect.objectContaining({ key: "vector:sparse" })]);
      } else {
        await expect(
          vectors.search({
            mode: "sparse",
            sparse: { indices: [3], values: [1] },
          }),
        ).rejects.toMatchObject({
          code: "unsupported_capability",
        });
      }

      if (capabilities.hybrid) {
        await vectors.upsert([
          {
            key: "vector:hybrid",
            dense: [1, 0],
            sparse: { indices: [3], values: [2] },
            metadata: { namespace: "hybrid" },
          },
        ]);
        await expect(
          vectors.search({
            mode: "hybrid",
            dense: [1, 0],
            sparse: { indices: [3], values: [1] },
            filter: { namespace: "hybrid" },
          }),
        ).resolves.toEqual([expect.objectContaining({ key: "vector:hybrid" })]);
      } else {
        await expect(
          vectors.search({
            mode: "hybrid",
            dense: [1, 0],
            sparse: { indices: [3], values: [1] },
          }),
        ).rejects.toMatchObject({ code: "unsupported_capability" });
      }

      const unsupportedFusion = (["rrf", "dbsf"] as const).find(
        (fusion) => !capabilities.fusion.includes(fusion),
      );
      if (unsupportedFusion) {
        await expect(
          vectors.search({
            mode: "hybrid",
            dense: [1, 0],
            sparse: { indices: [3], values: [1] },
            fusion: unsupportedFusion,
          }),
        ).rejects.toMatchObject({ code: "unsupported_capability" });
      }
    });
  });
}
