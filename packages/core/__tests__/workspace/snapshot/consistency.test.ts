import { describe, expect, it } from "vitest";
import { workspace } from "../../../src/workspace";
import type { JsonObject } from "../../../src/storage";
import {
  controlledAssetStore,
  controlledRecordStore,
  snapshotAssetUri,
  storedValues,
} from "./fixtures";

describe("workspace snapshot consistency", () => {
  it("captures wholly after a two-path transaction target commit", async () => {
    const records = controlledRecordStore();
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: records.store,
    });
    await ws.write("/outputs/a.md", "old-a");
    await ws.write("/outputs/b.md", "old-b");
    const firstTargetPut = records.blockPutWhen(
      (value) =>
        value._cruxWorkspaceFile === true &&
        value.namespace === "thread:1" &&
        value.path === "/outputs/a.md" &&
        value.inlineText === "new-a",
    );

    const transaction = ws.transaction(async (tx) => {
      await tx.write("/outputs/b.md", "new-b");
      await tx.write("/outputs/a.md", "new-a");
    });
    await firstTargetPut.entered;

    const capture = ws.snapshot.create({ path: "/outputs" });
    await Promise.resolve();
    await Promise.resolve();
    firstTargetPut.release();

    const [, snapshot] = await Promise.all([transaction, capture]);
    expect(await capturedInlineText(records.store, snapshot.id)).toEqual({
      "/outputs/a.md": "new-a",
      "/outputs/b.md": "new-b",
    });
  });

  it("waits for an in-progress ordinary write before capture", async () => {
    const records = controlledRecordStore();
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: records.store,
    });
    await ws.write("/outputs/report.md", "old");
    const targetPut = records.blockPutWhen(
      (value) =>
        value._cruxWorkspaceFile === true &&
        value.namespace === "thread:1" &&
        value.path === "/outputs/report.md" &&
        value.inlineText === "new",
    );

    const writing = ws.write("/outputs/report.md", "new");
    await targetPut.entered;
    const capturing = ws.snapshot.create({ path: "/outputs/report.md" });
    await Promise.resolve();
    targetPut.release();

    const [, snapshot] = await Promise.all([writing, capturing]);
    expect(await capturedInlineText(records.store, snapshot.id)).toEqual({
      "/outputs/report.md": "new",
    });
  });

  it("holds a transaction target commit behind an in-progress capture", async () => {
    const records = controlledRecordStore();
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: records.store,
    });
    await ws.write("/outputs/a.md", "old-a");
    await ws.write("/outputs/b.md", "old-b");
    const snapshotEntryPut = records.blockPutWhen(
      (value) =>
        value._cruxWorkspaceSnapshotEntry === true &&
        value.path === "/outputs/a.md",
    );

    const capture = ws.snapshot.create({ path: "/outputs" });
    await snapshotEntryPut.entered;
    let staged!: () => void;
    const transactionStaged = new Promise<void>((resolve) => {
      staged = resolve;
    });
    const transaction = ws.transaction(async (tx) => {
      await tx.write("/outputs/a.md", "new-a");
      await tx.write("/outputs/b.md", "new-b");
      staged();
    });
    await transactionStaged;
    await Promise.resolve();
    snapshotEntryPut.release();

    const [snapshot] = await Promise.all([capture, transaction]);
    expect(await capturedInlineText(records.store, snapshot.id)).toEqual({
      "/outputs/a.md": "old-a",
      "/outputs/b.md": "old-b",
    });
    await expect(ws.read("/outputs/a.md")).resolves.toMatchObject({
      content: "new-a",
    });
    await expect(ws.read("/outputs/b.md")).resolves.toMatchObject({
      content: "new-b",
    });
  });

  it("serializes two competing restores in invocation order", async () => {
    const records = controlledRecordStore();
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: records.store,
    });
    await ws.write("/outputs/report.md", "snapshot-a");
    const snapshotA = await ws.snapshot.create({ path: "/outputs/report.md" });
    await ws.write("/outputs/report.md", "snapshot-b");
    const snapshotB = await ws.snapshot.create({ path: "/outputs/report.md" });
    await ws.write("/outputs/report.md", "live");
    const firstRestorePut = records.blockPutWhen(
      (value) =>
        value._cruxWorkspaceFile === true &&
        value.namespace === "thread:1" &&
        value.path === "/outputs/report.md" &&
        value.inlineText === "snapshot-a",
    );

    const restoreA = ws.snapshot.restore(snapshotA);
    await firstRestorePut.entered;
    const restoreB = ws.snapshot.restore(snapshotB);
    await Promise.resolve();
    firstRestorePut.release();

    await expect(Promise.all([restoreA, restoreB])).resolves.toMatchObject([
      { restoredFiles: 1 },
      { restoredFiles: 1 },
    ]);
    await expect(ws.read("/outputs/report.md")).resolves.toMatchObject({
      content: "snapshot-b",
    });
    const history = await ws.history("/outputs/report.md");
    expect(history.slice(0, 2)).toMatchObject([
      { operation: "restore" },
      { operation: "restore" },
    ]);
  });

  it("holds snapshot deletion while restore reads owned assets", async () => {
    const records = controlledRecordStore();
    const assets = controlledAssetStore();
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: records.store,
      assets: assets.store,
      content: { inlineTextBelowBytes: 0 },
    });
    await ws.write("/outputs/image.bin", new Uint8Array([1, 2, 3]));
    const snapshot = await ws.snapshot.create({ path: "/outputs/image.bin" });
    const snapshotUri = await snapshotAssetUri(records.store, snapshot.id);
    await ws.delete("/outputs/image.bin");
    const assetRead = assets.blockGetWhen((ref) => ref.uri === snapshotUri);

    const restoring = ws.snapshot.restore(snapshot);
    await assetRead.entered;
    let deleteCompleted = false;
    const deleting = ws.snapshot.delete(snapshot).then(() => {
      deleteCompleted = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(deleteCompleted).toBe(false);
    assetRead.release();
    await expect(restoring).resolves.toMatchObject({ restoredFiles: 1 });
    await deleting;
    await expect(ws.read("/outputs/image.bin")).resolves.toMatchObject({
      kind: "binary",
      size: 3,
    });
    await expect(ws.snapshot.list()).resolves.toEqual({ snapshots: [] });
  });
});

async function capturedInlineText(
  store: Parameters<typeof storedValues>[0],
  snapshotId: string,
): Promise<Record<string, string>> {
  const entries = await storedValues(
    store,
    (value) =>
      value._cruxWorkspaceSnapshotEntry === true &&
      value.snapshotId === snapshotId,
  );
  return Object.fromEntries(entries.map(snapshotTextEntry));
}

function snapshotTextEntry(value: JsonObject): readonly [string, string] {
  if (
    typeof value.path !== "string" ||
    !isJsonObject(value.head) ||
    !isJsonObject(value.head.payload) ||
    typeof value.head.payload.content !== "string"
  ) {
    throw new Error("Expected an inline-text snapshot entry.");
  }
  return [value.path, value.head.payload.content] as const;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
