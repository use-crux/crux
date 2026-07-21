import { describe, expect, it } from "vitest";
import { workspace } from "../../../src/workspace";
import {
  controlledAssetStore,
  controlledRecordStore,
  deleteStoredRecords,
  snapshotAssetUri,
  storedValues,
} from "./fixtures";

describe("workspace snapshot failures", () => {
  it("keeps a creating snapshot invisible until its header commits", async () => {
    const records = controlledRecordStore();
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: records.store,
    });
    await ws.write("/outputs/report.txt", "report");
    const barrier = records.blockPutWhen(
      (value) => value._cruxWorkspaceSnapshotEntry === true,
    );

    const creating = ws.snapshot.create({ path: "/outputs/report.txt" });
    await barrier.entered;

    await expect(ws.snapshot.list()).resolves.toEqual({ snapshots: [] });
    barrier.release();
    await expect(creating).resolves.toMatchObject({ fileCount: 1 });
  });

  it("holds an ordinary delete until an in-progress capture commits", async () => {
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
    const barrier = records.blockPutWhen(
      (value) => value._cruxWorkspaceSnapshotEntry === true,
    );
    const creating = ws.snapshot.create({ path: "/outputs/image.bin" });
    await barrier.entered;

    let deleteCompleted = false;
    const deleting = ws.delete("/outputs/image.bin").then(() => {
      deleteCompleted = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(deleteCompleted).toBe(false);
    barrier.release();
    const snapshot = await creating;
    await deleting;
    const uri = await snapshotAssetUri(records.store, snapshot.id);
    await expect(assets.store.get({ uri })).resolves.toMatchObject({ size: 3 });
  });

  it("cleans copied assets and creating records after entry persistence fails", async () => {
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
    const failure = new Error("entry write failed");
    records.failPutWhen(
      (value) => value._cruxWorkspaceSnapshotEntry === true,
      failure,
    );

    await expect(
      ws.snapshot.create({ path: "/outputs/image.bin" }),
    ).rejects.toMatchObject({ code: "backend_error", cause: failure });

    const snapshotAsset = assets.putRefs.at(-1)!;
    expect(assets.deletedRefs).toContainEqual(snapshotAsset);
    await expect(assets.store.get(snapshotAsset)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(ws.snapshot.list()).resolves.toEqual({ snapshots: [] });
    await expect(snapshotRecords(records.store)).resolves.toEqual([]);
  });

  it("keeps absent-header residual cleanup best-effort and idempotent", async () => {
    const records = controlledRecordStore();
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: records.store,
    });
    await ws.write("/outputs/report.txt", "report");
    const snapshot = await ws.snapshot.create({ path: "/outputs/report.txt" });
    await deleteStoredRecords(
      records.store,
      (value) =>
        value._cruxWorkspaceSnapshot === true && value.id === snapshot.id,
    );
    records.failLists(new Error("residual listing failed"));

    await expect(ws.snapshot.delete(snapshot)).resolves.toBeUndefined();
  });

  it("cleans materialized entries when the committed header write fails", async () => {
    const records = controlledRecordStore();
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: records.store,
    });
    await ws.write("/outputs/report.txt", "report");
    const failure = new Error("header commit failed");
    records.failPutWhen(
      (value) =>
        value._cruxWorkspaceSnapshot === true && value.state === "committed",
      failure,
    );

    await expect(
      ws.snapshot.create({ path: "/outputs/report.txt" }),
    ).rejects.toMatchObject({ code: "backend_error", cause: failure });

    await expect(ws.snapshot.list()).resolves.toEqual({ snapshots: [] });
    await expect(snapshotRecords(records.store)).resolves.toEqual([]);
  });

  it("leaves no visible snapshot when a live asset read fails", async () => {
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
    const failure = new Error("asset read failed");
    assets.failGets(failure);

    await expect(
      ws.snapshot.create({ path: "/outputs/image.bin" }),
    ).rejects.toMatchObject({ code: "backend_error", cause: failure });

    expect(assets.putRefs).toHaveLength(1);
    await expect(ws.snapshot.list()).resolves.toEqual({ snapshots: [] });
    await expect(snapshotRecords(records.store)).resolves.toEqual([]);
  });

  it("hides a deleting snapshot and retries failed asset cleanup", async () => {
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
    const snapshotAsset = assets.putRefs.at(-1)!;
    const failure = new Error("asset delete failed");
    assets.failDelete(snapshotAsset, failure);

    await expect(ws.snapshot.delete(snapshot)).rejects.toMatchObject({
      code: "backend_error",
      cause: failure,
    });
    await expect(ws.snapshot.list()).resolves.toEqual({ snapshots: [] });

    assets.clearFailures();
    await expect(ws.snapshot.delete(snapshot)).resolves.toBeUndefined();
    await expect(ws.snapshot.delete(snapshot)).resolves.toBeUndefined();
    await expect(assets.store.get(snapshotAsset)).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

function snapshotRecords(store: Parameters<typeof storedValues>[0]) {
  return storedValues(
    store,
    (value) =>
      value._cruxWorkspaceSnapshot === true ||
      value._cruxWorkspaceSnapshotEntry === true,
  );
}
