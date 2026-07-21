import { describe, expect, it } from "vitest";
import {
  inMemoryAssetStore,
  inMemoryRecordStore,
  storage,
} from "../../../src/storage";
import { workspace, type WorkspaceSnapshotRef } from "../../../src/workspace";

describe("workspace snapshot restore", () => {
  it("restores a JSON-round-tripped empty snapshot by deleting later files", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });
    const snapshot = await ws.snapshot.create({ path: "/outputs" });
    await ws.write("/outputs/later.md", "later");
    const persisted = JSON.parse(
      JSON.stringify(snapshot),
    ) as WorkspaceSnapshotRef;

    await expect(ws.snapshot.restore(persisted)).resolves.toEqual({
      restoredFiles: 0,
      deletedFiles: 1,
      unchangedFiles: 0,
    });
    await expect(ws.exists("/outputs/later.md")).resolves.toBe(false);
  });

  it("creates a missing captured inline file", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });
    await ws.write("/outputs/report.md", "captured", {
      mimeType: "text/markdown",
    });
    const snapshot = await ws.snapshot.create({ path: "/outputs/report.md" });
    await ws.delete("/outputs/report.md");

    await expect(ws.snapshot.restore(snapshot)).resolves.toEqual({
      restoredFiles: 1,
      deletedFiles: 0,
      unchangedFiles: 0,
    });
    await expect(ws.read("/outputs/report.md")).resolves.toMatchObject({
      kind: "text",
      content: "captured",
      mimeType: "text/markdown",
    });
  });

  it("replaces a changed file and appends restore history", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });
    await ws.write("/outputs/report.md", "captured");
    const snapshot = await ws.snapshot.create({ path: "/outputs/report.md" });
    await ws.write("/outputs/report.md", "later");

    await expect(ws.snapshot.restore(snapshot)).resolves.toEqual({
      restoredFiles: 1,
      deletedFiles: 0,
      unchangedFiles: 0,
    });
    await expect(ws.read("/outputs/report.md")).resolves.toMatchObject({
      kind: "text",
      content: "captured",
    });
    await expect(ws.history("/outputs/report.md")).resolves.toMatchObject([
      { version: 3, operation: "restore" },
      { version: 2, operation: "write" },
      { version: 1, operation: "write" },
    ]);
    await expect(
      ws.read("/outputs/report.md", { version: 2 }),
    ).resolves.toMatchObject({ content: "later" });
  });

  it("skips an identical logical file without appending history", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });
    await ws.write("/outputs/report.md", "captured");
    const snapshot = await ws.snapshot.create({ path: "/outputs/report.md" });

    await expect(ws.snapshot.restore(snapshot)).resolves.toEqual({
      restoredFiles: 0,
      deletedFiles: 0,
      unchangedFiles: 1,
    });
    await expect(ws.history("/outputs/report.md")).resolves.toHaveLength(1);
  });

  it("reports disjoint counts for a mixed exact-tree restore", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });
    await ws.write("/outputs/create.md", "captured create");
    await ws.write("/outputs/replace.md", "captured replace");
    await ws.write("/outputs/unchanged.md", "captured unchanged");
    const snapshot = await ws.snapshot.create({ path: "/outputs" });
    await ws.delete("/outputs/create.md");
    await ws.write("/outputs/replace.md", "later replace");
    await ws.write("/outputs/delete.md", "later delete");

    await expect(ws.snapshot.restore(snapshot)).resolves.toEqual({
      restoredFiles: 2,
      deletedFiles: 1,
      unchangedFiles: 1,
    });
    await expect(ws.exists("/outputs/delete.md")).resolves.toBe(false);
    await expect(ws.read("/outputs/create.md")).resolves.toMatchObject({
      content: "captured create",
    });
    await expect(ws.read("/outputs/replace.md")).resolves.toMatchObject({
      content: "captured replace",
    });
    await expect(ws.history("/outputs/unchanged.md")).resolves.toHaveLength(1);
  });

  it("leaves files outside the captured root untouched", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });
    await ws.write("/outputs/captured/inside.md", "inside");
    const snapshot = await ws.snapshot.create({ path: "/outputs/captured" });
    await ws.write("/outputs/outside.md", "outside");

    await expect(ws.snapshot.restore(snapshot)).resolves.toEqual({
      restoredFiles: 0,
      deletedFiles: 0,
      unchangedFiles: 1,
    });
    await expect(ws.read("/outputs/outside.md")).resolves.toMatchObject({
      content: "outside",
    });
  });

  it("restores an asset-backed file from snapshot-owned bytes", async () => {
    const records = inMemoryRecordStore();
    const assets = inMemoryAssetStore();
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      storage: storage({ records, assets }),
      content: { inlineTextBelowBytes: 0 },
    });
    const captured = new Uint8Array([0, 1, 2, 255]);
    await ws.write("/outputs/image.bin", captured);
    const snapshot = await ws.snapshot.create({ path: "/outputs/image.bin" });
    await ws.delete("/outputs/image.bin");

    await expect(ws.snapshot.restore(snapshot)).resolves.toEqual({
      restoredFiles: 1,
      deletedFiles: 0,
      unchangedFiles: 0,
    });
    const restored = await ws.read("/outputs/image.bin");
    expect(restored).toMatchObject({
      kind: "binary",
      mimeType: "application/octet-stream",
      size: 4,
    });
    if (restored.kind !== "binary") throw new Error("Expected binary content.");
    const liveAsset = await assets.get({ uri: restored.uri });
    expect(liveAsset).toMatchObject({ type: "data", data: captured });
  });

  it("keeps a restored snapshot committed, listable, and reusable", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });
    await ws.write("/outputs/report.md", "captured");
    const snapshot = await ws.snapshot.create({ path: "/outputs/report.md" });

    await ws.write("/outputs/report.md", "later one");
    await expect(ws.snapshot.restore(snapshot)).resolves.toMatchObject({
      restoredFiles: 1,
    });
    await expect(ws.snapshot.list()).resolves.toEqual({
      snapshots: [snapshot],
    });

    await ws.write("/outputs/report.md", "later two");
    await expect(ws.snapshot.restore(snapshot)).resolves.toMatchObject({
      restoredFiles: 1,
    });
    await expect(ws.snapshot.restore(snapshot)).resolves.toEqual({
      restoredFiles: 0,
      deletedFiles: 0,
      unchangedFiles: 1,
    });
  });
});
