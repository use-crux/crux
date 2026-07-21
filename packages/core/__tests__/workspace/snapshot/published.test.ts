import { describe, expect, it } from "vitest";
import { inMemoryAssetStore, inMemoryRecordStore } from "../../../src/storage";
import { workspace } from "../../../src/workspace";
import {
  deleteStoredRecords,
  snapshotAssetUris,
  snapshotEntry,
} from "./fixtures";

describe("workspace snapshot published state", () => {
  it("captures a distinct pinned projection beside working HEAD", async () => {
    const records = inMemoryRecordStore();
    const ws = workspace({ id: "research", namespace: "thread:1", records });
    await ws.write("/outputs/report.md", "published", { kind: "report" });
    await ws.finalize("/outputs/report.md");
    await ws.write("/outputs/report.md", "working");

    const snapshot = await ws.snapshot.create({ path: "/outputs/report.md" });
    const entry = await snapshotEntry(records, snapshot.id);

    expect(snapshot).toMatchObject({ fileCount: 1, sizeBytes: 16 });
    expect(entry.head).toMatchObject({
      payload: { kind: "text", content: "working" },
    });
    expect(entry.published).toMatchObject({
      kind: "distinct",
      state: { payload: { kind: "text", content: "published" } },
    });
  });

  it("stores an equal published projection as shared with HEAD", async () => {
    const records = inMemoryRecordStore();
    const ws = workspace({ id: "research", namespace: "thread:1", records });
    await ws.write("/outputs/report.md", "published", { kind: "report" });
    await ws.finalize("/outputs/report.md");

    const snapshot = await ws.snapshot.create({ path: "/outputs/report.md" });
    const entry = await snapshotEntry(records, snapshot.id);

    expect(snapshot).toMatchObject({ fileCount: 1, sizeBytes: 9 });
    expect(entry.published).toEqual({ kind: "shared" });
  });

  it("normalizes a missing published pin to shared HEAD", async () => {
    const records = inMemoryRecordStore();
    const ws = workspace({ id: "research", namespace: "thread:1", records });
    await ws.write("/outputs/report.md", "published", { kind: "report" });
    await ws.finalize("/outputs/report.md");
    await ws.write("/outputs/report.md", "working");
    await deleteStoredRecords(
      records,
      (value) => value._cruxWorkspaceVersion === true && value.version === 1,
    );

    const snapshot = await ws.snapshot.create({ path: "/outputs/report.md" });
    const entry = await snapshotEntry(records, snapshot.id);

    expect(snapshot).toMatchObject({ fileCount: 1, sizeBytes: 7 });
    expect(entry.published).toEqual({ kind: "shared" });
  });

  it("independently owns distinct asset-backed HEAD and published bytes", async () => {
    const records = inMemoryRecordStore();
    const assets = inMemoryAssetStore();
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records,
      assets,
      content: { inlineTextBelowBytes: 0 },
    });
    await ws.write("/outputs/image.bin", new Uint8Array([1]));
    await ws.finalize("/outputs/image.bin");
    await ws.write("/outputs/image.bin", new Uint8Array([2, 3]));

    const snapshot = await ws.snapshot.create({ path: "/outputs/image.bin" });
    const uris = await snapshotAssetUris(records, snapshot.id);

    expect(snapshot).toMatchObject({ fileCount: 1, sizeBytes: 3 });
    expect(new Set(uris).size).toBe(2);
    await ws.delete("/outputs/image.bin");
    await expect(assets.get({ uri: uris[0]! })).resolves.toMatchObject({
      size: 2,
    });
    await expect(assets.get({ uri: uris[1]! })).resolves.toMatchObject({
      size: 1,
    });

    await ws.snapshot.delete(snapshot);
    for (const uri of uris) {
      await expect(assets.get({ uri })).rejects.toMatchObject({
        code: "not_found",
      });
    }
  });
});
