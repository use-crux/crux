import { describe, expect, it } from "vitest";
import { inMemoryAssetStore } from "../../src/asset";
import { createSlidingWindow } from "../../src/compaction/sliding-window";
import type { GenerateTextFn } from "../../src/compaction/types";
import { inMemoryRecordStore } from "../../src/storage";

const generate: GenerateTextFn = async () => ({ text: "Summary" });

describe("sliding-window atomic persistence", () => {
  it("keeps summary, window, stats, and assets unchanged when the state commit fails", async () => {
    const backingRecords = inMemoryRecordStore();
    const backingAssets = inMemoryAssetStore();
    const deletedRefs: string[] = [];
    let failRecordPut = false;
    const records = {
      ...backingRecords,
      put: async (...args: Parameters<typeof backingRecords.put>) => {
        if (failRecordPut) throw new Error("state commit failed");
        return backingRecords.put(...args);
      },
    };
    const assets = {
      ...backingAssets,
      delete: async (ref: Parameters<typeof backingAssets.delete>[0]) => {
        deletedRefs.push(ref.uri);
        return backingAssets.delete(ref);
      },
    };
    const storage = { records, assets };
    const window = createSlidingWindow({ windowSize: 1, generate, model: "test", storage });

    await window.push({ role: "user", content: "Keep me" });
    const beforeRecord = await records.get("compact:default:state");
    const beforeStats = window.getStats();
    failRecordPut = true;

    await expect(
      window.push({
        role: "user",
        content: [{ type: "image", source: new Uint8Array([1, 2, 3]), mediaType: "image/png" }],
      }),
    ).rejects.toThrow("state commit failed");

    expect(await records.get("compact:default:state")).toEqual(beforeRecord);
    expect(window.getStats()).toEqual(beforeStats);
    expect(deletedRefs).toHaveLength(1);
    await expect(assets.get({ uri: deletedRefs[0]! })).rejects.toBeDefined();

    const restarted = createSlidingWindow({ windowSize: 1, generate, model: "test", storage });
    expect(await restarted.getMessages()).toEqual([{ role: "user", content: "Keep me" }]);
  });
});
