import { describe, expect, it } from "vitest";
import type { AssetStore } from "../../asset";

/** Options for {@link describeAssetStoreConformance}. */
export interface DescribeAssetStoreConformanceOptions {
  /** Human-readable adapter name used for the Vitest `describe()` block. */
  readonly name: string;
  /** Create a fresh, isolated asset store for each conformance test. */
  readonly prepare: () => AssetStore | Promise<AssetStore>;
}

/** Register shared behavior checks for `AssetStore` adapters. */
export function describeAssetStoreConformance(
  options: DescribeAssetStoreConformanceOptions,
): void {
  describe(`${options.name} AssetStore conformance`, () => {
    it("puts, reads, deletes, and preserves usable data assets", async () => {
      const assets = await options.prepare();
      const stored = await assets.put(
        {
          type: "data",
          data: new TextEncoder().encode("hello"),
          mediaType: "text/plain",
          size: 5,
        },
        { key: "reports/a.txt" },
      );

      expect(stored).toMatchObject({
        type: "data",
        mediaType: "text/plain",
        size: 5,
        ref: { uri: expect.any(String) },
      });
      const read = await assets.get(stored.ref);
      expect(read).toMatchObject({
        type: "data",
        mediaType: "text/plain",
        size: 5,
      });
      if (read.type !== "data") throw new Error("expected data asset");
      if (read.data instanceof Uint8Array) {
        expect(read.data).toEqual(new TextEncoder().encode("hello"));
      } else {
        await expect(read.data.text()).resolves.toBe("hello");
      }
      await assets.delete(stored.ref);
      await expect(assets.get(stored.ref)).rejects.toMatchObject({
        code: "not_found",
      });
    });
  });
}
