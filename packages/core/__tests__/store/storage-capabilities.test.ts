import { describe, expect, it } from "vitest";
import {
  inMemoryAssetStore,
  inMemoryRecordStore,
  inMemoryStorage,
  inMemoryVectorStore,
  storage,
} from "../../src/storage";

describe("storage capabilities", () => {
  it("keeps document data, vector search, and assets as explicit capabilities", async () => {
    const records = inMemoryRecordStore();
    const vectors = inMemoryVectorStore();
    const assets = inMemoryAssetStore();
    const bundle = storage({ records, vectors, assets });

    await bundle.records.put("docs:a", { title: "Alpha" });
    await bundle.vectors?.upsert([{ key: "docs:a", dense: [1, 0] }]);
    const asset = await bundle.assets?.put(
      {
        type: "data",
        data: new TextEncoder().encode("report"),
        mediaType: "text/plain",
        size: 6,
      },
      { key: "outputs/report.txt" },
    );

    await expect(bundle.records.get("docs:a")).resolves.toMatchObject({
      title: "Alpha",
    });
    await expect(
      bundle.vectors?.search({ mode: "dense", dense: [1, 0] }),
    ).resolves.toEqual([expect.objectContaining({ key: "docs:a", score: 1 })]);
    await expect(
      bundle.assets?.get(asset?.ref ?? { uri: "" }),
    ).resolves.toMatchObject({
      mediaType: "text/plain",
      size: 6,
    });
    expect(Object.isFrozen(bundle)).toBe(true);
  });

  it("does not pretend a record store is a vector or asset store", () => {
    const records = inMemoryRecordStore();

    expect("search" in records).toBe(false);
    expect("createReadUrl" in records).toBe(false);
  });

  it("provides a complete in-memory bundle for tests and demos", () => {
    const bundle = inMemoryStorage();

    expect(bundle.records._tag).toBe("RecordStore");
    expect(bundle.vectors?._tag).toBe("VectorStore");
    expect(bundle.assets).toBeDefined();
  });
});
