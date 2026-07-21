import { describe, expect, it } from "vitest";
import type { JsonObject } from "../../../src/storage";
import { workspace } from "../../../src/workspace";
import {
  controlledAssetStore,
  controlledRecordStore,
  snapshotAssetUri,
} from "./fixtures";

describe("workspace snapshot delete validation", () => {
  it("does not delete a live asset when a snapshot bearer ref is redirected", async () => {
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
    await ws.delete("/outputs/image.bin");
    await ws.write("/outputs/image.bin", new Uint8Array([1, 2, 3]));
    const live = await ws.read("/outputs/image.bin");
    if (live.kind !== "binary") throw new Error("Expected binary content.");

    const page = await records.store.list("workspace:");
    const storedEntry = page.entries.find(
      ({ value }) =>
        value._cruxWorkspaceSnapshotEntry === true &&
        value.snapshotId === snapshot.id,
    );
    if (
      !storedEntry ||
      !isJsonObject(storedEntry.value.head) ||
      !isJsonObject(storedEntry.value.head.payload)
    ) {
      throw new Error("Expected an asset-backed snapshot entry.");
    }
    await records.store.put(storedEntry.key, {
      ...storedEntry.value,
      head: {
        ...storedEntry.value.head,
        payload: {
          ...storedEntry.value.head.payload,
          assetUri: live.uri,
        },
      },
    });

    await expect(ws.snapshot.delete(snapshot)).rejects.toMatchObject({
      code: "corrupt_snapshot",
      snapshotId: snapshot.id,
    });
    await expect(assets.store.get({ uri: live.uri })).resolves.toMatchObject({
      data: new Uint8Array([1, 2, 3]),
    });
    await expect(ws.read("/outputs/image.bin")).resolves.toMatchObject({
      kind: "binary",
      uri: live.uri,
    });
    await expect(ws.snapshot.list()).resolves.toEqual({
      snapshots: [snapshot],
    });
  });

  it("cleans committed metadata when an owned asset is already missing", async () => {
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
    await assets.store.delete({ uri: snapshotUri });

    await expect(ws.snapshot.delete(snapshot)).resolves.toBeUndefined();
    await expect(ws.snapshot.list()).resolves.toEqual({ snapshots: [] });
  });
});

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
