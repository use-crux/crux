import { describe, expect, it, vi } from "vitest";
import { inMemoryRecordStore } from "../../../src/storage";
import type { JsonObject } from "../../../src/storage";
import { workspace } from "../../../src/workspace";
import {
  controlledAssetStore,
  controlledRecordStore,
  rewritableListedValues,
  snapshotAssetUri,
} from "./fixtures";

describe("workspace snapshot restore validation", () => {
  it("rejects a corrupted entry fingerprint before live mutation", async () => {
    const records = controlledRecordStore();
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: records.store,
    });
    await ws.write("/outputs/report.md", "captured");
    const snapshot = await ws.snapshot.create({ path: "/outputs/report.md" });
    await ws.write("/outputs/report.md", "later");
    const page = await records.store.list("workspace:");
    const storedEntry = page.entries.find(
      ({ value }) =>
        value._cruxWorkspaceSnapshotEntry === true &&
        value.snapshotId === snapshot.id,
    );
    if (!storedEntry) throw new Error("Expected stored snapshot entry.");
    await records.store.put(storedEntry.key, {
      ...storedEntry.value,
      entryFingerprint: "corrupted",
    });

    await expect(ws.snapshot.restore(snapshot)).rejects.toMatchObject({
      code: "corrupt_snapshot",
      snapshotId: snapshot.id,
    });
    await expect(ws.read("/outputs/report.md")).resolves.toMatchObject({
      content: "later",
    });
    await expect(ws.history("/outputs/report.md")).resolves.toHaveLength(2);
  });

  it("rejects a missing snapshot asset before live mutation", async () => {
    const records = controlledRecordStore();
    const assets = controlledAssetStore();
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: records.store,
      assets: assets.store,
      content: { inlineTextBelowBytes: 0 },
    });
    await ws.write("/outputs/image.bin", new Uint8Array([1]));
    const snapshot = await ws.snapshot.create({ path: "/outputs/image.bin" });
    const snapshotUri = await snapshotAssetUri(records.store, snapshot.id);
    await ws.write("/outputs/image.bin", new Uint8Array([2]));
    await assets.store.delete({ uri: snapshotUri });

    await expect(ws.snapshot.restore(snapshot)).rejects.toMatchObject({
      code: "backend_error",
      snapshotId: snapshot.id,
      cause: expect.objectContaining({ code: "not_found" }),
    });
    const live = await ws.read("/outputs/image.bin");
    if (live.kind !== "binary") throw new Error("Expected binary content.");
    await expect(assets.store.get({ uri: live.uri })).resolves.toMatchObject({
      data: new Uint8Array([2]),
    });
    await expect(ws.history("/outputs/image.bin")).resolves.toHaveLength(2);
  });

  it("classifies malformed snapshot JSON asset bytes as corruption", async () => {
    const records = controlledRecordStore();
    const assets = controlledAssetStore();
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: records.store,
      assets: assets.store,
      content: { inlineTextBelowBytes: 0 },
    });
    await ws.write("/outputs/data.json", { captured: true });
    const snapshot = await ws.snapshot.create({ path: "/outputs/data.json" });
    const snapshotUri = await snapshotAssetUri(records.store, snapshot.id);
    const encodedKey = snapshotUri.split("/key/")[1];
    if (!encodedKey) throw new Error("Expected keyed snapshot asset URI.");
    const malformed = new TextEncoder().encode(
      `{${" ".repeat(snapshot.sizeBytes - 1)}`,
    );
    await assets.store.put(
      {
        type: "data",
        data: malformed,
        mediaType: "application/json",
        size: malformed.byteLength,
      },
      { key: decodeURIComponent(encodedKey) },
    );
    await ws.write("/outputs/data.json", { later: true });

    await expect(ws.snapshot.restore(snapshot)).rejects.toMatchObject({
      code: "corrupt_snapshot",
      snapshotId: snapshot.id,
    });
    await expect(ws.read("/outputs/data.json")).resolves.toMatchObject({
      content: { later: true },
    });
  });

  it("rejects recursively invalid inline JSON before live mutation", async () => {
    const records = controlledRecordStore();
    const corruptible = rewritableListedValues(records.store);
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: corruptible.store,
    });
    await ws.write("/outputs/data.json", { value: null });
    const snapshot = await ws.snapshot.create({ path: "/outputs/data.json" });
    await ws.write("/outputs/data.json", { later: true });
    corruptible.rewriteWhen(
      (value) =>
        value._cruxWorkspaceSnapshotEntry === true &&
        value.snapshotId === snapshot.id,
      (value) => {
        if (!isJsonObject(value.head) || !isJsonObject(value.head.payload)) {
          throw new Error("Expected an inline JSON snapshot entry.");
        }
        return {
          ...value,
          head: {
            ...value.head,
            payload: {
              ...value.head.payload,
              content: { value: Number.NaN },
            },
          },
        };
      },
    );

    await expect(ws.snapshot.restore(snapshot)).rejects.toMatchObject({
      code: "corrupt_snapshot",
      snapshotId: snapshot.id,
    });
    await expect(ws.read("/outputs/data.json")).resolves.toMatchObject({
      content: { later: true },
    });
  });

  it("rejects recursively invalid descriptor metadata", async () => {
    const records = controlledRecordStore();
    const corruptible = rewritableListedValues(records.store);
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: corruptible.store,
    });
    await ws.write("/outputs/report.md", "captured", {
      metadata: { value: null },
    });
    const snapshot = await ws.snapshot.create({ path: "/outputs/report.md" });
    await ws.write("/outputs/report.md", "later");
    corruptible.rewriteWhen(
      (value) =>
        value._cruxWorkspaceSnapshotEntry === true &&
        value.snapshotId === snapshot.id,
      (value) => {
        if (!isJsonObject(value.head) || !isJsonObject(value.head.descriptor)) {
          throw new Error("Expected a snapshot descriptor.");
        }
        return {
          ...value,
          head: {
            ...value.head,
            descriptor: {
              ...value.head.descriptor,
              metadata: { value: Number.NaN },
            },
          },
        };
      },
    );

    await expect(ws.snapshot.restore(snapshot)).rejects.toMatchObject({
      code: "corrupt_snapshot",
      snapshotId: snapshot.id,
    });
    await expect(ws.read("/outputs/report.md")).resolves.toMatchObject({
      content: "later",
    });
  });

  it("validates destination quota before creating an absent path", async () => {
    const records = controlledRecordStore();
    const source = workspace({
      id: "research",
      namespace: "thread:1",
      records: records.store,
    });
    await source.write("/outputs/report.md", "too large");
    const snapshot = await source.snapshot.create({
      path: "/outputs/report.md",
    });
    await source.delete("/outputs/report.md");
    const limited = workspace({
      id: "research",
      namespace: "thread:1",
      records: records.store,
      limits: { maxFileBytes: 4 },
    });

    await expect(limited.snapshot.restore(snapshot)).rejects.toMatchObject({
      code: "backend_error",
      snapshotId: snapshot.id,
      cause: expect.any(Error),
    });
    await expect(limited.exists("/outputs/report.md")).resolves.toBe(false);
    await expect(limited.history("/outputs/report.md")).resolves.toEqual([]);
  });

  it("rejects a source-backed destination overlap before storage mutation", async () => {
    const records = inMemoryRecordStore();
    const local = workspace({
      id: "research",
      namespace: "thread:1",
      records,
    });
    await local.write("/outputs/report.md", "captured");
    const snapshot = await local.snapshot.create({
      path: "/outputs/report.md",
    });
    await local.write("/outputs/report.md", "later");
    const put = vi.spyOn(records, "put");
    const remove = vi.spyOn(records, "delete");
    const sourceBacked = workspace({
      id: "research",
      namespace: "thread:1",
      records,
      mounts: [
        { path: "/workspace", access: "readwrite" },
        {
          path: "/outputs",
          access: "read",
          source: {
            kind: "custom",
            list: () => ({ entries: [] }),
            read: () => null,
          },
        },
      ],
    });

    await expect(sourceBacked.snapshot.restore(snapshot)).rejects.toMatchObject(
      {
        code: "unsupported_mount",
      },
    );
    expect(put).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    await expect(local.read("/outputs/report.md")).resolves.toMatchObject({
      content: "later",
    });
  });
});

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
