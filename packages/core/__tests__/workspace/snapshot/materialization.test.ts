import { describe, expect, it } from "vitest";
import { observe } from "../../../src/observability";
import { inMemoryAssetStore, inMemoryRecordStore } from "../../../src/storage";
import { workspace } from "../../../src/workspace";
import {
  snapshotAssetUri,
  snapshotEntry,
  snapshotEntryFingerprints,
} from "./fixtures";

describe("workspace snapshot materialization", () => {
  it("captures exact inline text independently from live state", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });
    await ws.write("/outputs/report.txt", "original");

    const snapshot = await ws.snapshot.create({ path: "/outputs/report.txt" });

    expect(snapshot).toMatchObject({
      path: "/outputs/report.txt",
      fileCount: 1,
      sizeBytes: 8,
    });
    await ws.write("/outputs/report.txt", "changed");
    await ws.delete("/outputs/report.txt");
    await expect(ws.snapshot.list()).resolves.toEqual({
      snapshots: [snapshot],
    });
  });

  it("canonicalizes inline JSON independently of object insertion order", async () => {
    const records = inMemoryRecordStore();
    const ws = workspace({ id: "research", namespace: "thread:1", records });
    await ws.write("/outputs/data.json", { b: 2, nested: { d: 4, c: 3 } });
    const first = await ws.snapshot.create({ path: "/outputs/data.json" });
    await ws.write("/outputs/data.json", { nested: { c: 3, d: 4 }, b: 2 });
    const second = await ws.snapshot.create({ path: "/outputs/data.json" });

    expect(first).toMatchObject({ fileCount: 1, sizeBytes: 30 });
    expect(second).toMatchObject({ fileCount: 1, sizeBytes: 30 });
    const fingerprints = await snapshotEntryFingerprints(records);
    expect(fingerprints.get(first.id)).toBe(fingerprints.get(second.id));
  });

  it("keeps JSON identity stable across inline and asset storage", async () => {
    const records = inMemoryRecordStore();
    const assets = inMemoryAssetStore();
    const inline = workspace({
      id: "research",
      namespace: "thread:1",
      records,
      assets,
    });
    const asset = workspace({
      id: "research",
      namespace: "thread:1",
      records,
      assets,
      content: { inlineTextBelowBytes: 0 },
    });
    await inline.write("/outputs/data.json", { b: 2, a: 1 });
    const first = await inline.snapshot.create({ path: "/outputs/data.json" });
    await asset.write("/outputs/data.json", { b: 2, a: 1 });
    const second = await asset.snapshot.create({ path: "/outputs/data.json" });

    const fingerprints = await snapshotEntryFingerprints(records);
    expect(fingerprints.get(first.id)).toBe(fingerprints.get(second.id));
  });

  it("copies asset-backed bytes into independent snapshot ownership", async () => {
    const records = inMemoryRecordStore();
    const assets = inMemoryAssetStore();
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records,
      assets,
      content: { inlineTextBelowBytes: 0 },
    });
    const bytes = new Uint8Array([0, 1, 2, 255]);
    await ws.write("/outputs/image.bin", bytes);
    const live = await ws.stat("/outputs/image.bin");

    const snapshot = await ws.snapshot.create({ path: "/outputs/image.bin" });
    const snapshotUri = await snapshotAssetUri(records, snapshot.id);

    expect(snapshot).toMatchObject({ fileCount: 1, sizeBytes: 4 });
    expect(live?.kind === "file" && live.uri).not.toBe(snapshotUri);
    await ws.delete("/outputs/image.bin");
    const stored = await assets.get({ uri: snapshotUri });
    expect(stored).toMatchObject({ type: "data", size: 4 });
    expect(stored.type === "data" && stored.data).toEqual(bytes);

    await ws.snapshot.delete(snapshot);
    await expect(assets.get({ uri: snapshotUri })).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("preserves metadata, lifecycle fields, and provenance", async () => {
    const records = inMemoryRecordStore();
    const ws = workspace({ id: "research", namespace: "thread:1", records });
    const run = observe.openRun({
      name: "snapshot provenance",
      rootPrimitive: "custom.operation",
    });
    await run.withContext(() =>
      observe.span({ name: "producer", primitive: "custom.operation" }, () =>
        ws.write("/outputs/report.md", "draft", {
          mimeType: "text/markdown",
          metadata: { nested: { b: 2, a: 1 } },
          status: "draft",
          kind: "report",
        }),
      ),
    );
    run.end();

    const snapshot = await ws.snapshot.create({ path: "/outputs/report.md" });
    const entry = await snapshotEntry(records, snapshot.id);

    expect(entry.head).toMatchObject({
      descriptor: {
        mimeType: "text/markdown",
        metadata: { nested: { a: 1, b: 2 } },
        status: "draft",
        kind: "report",
        producedBy: {
          runId: run.runId,
          spanId: expect.stringMatching(/^[0-9a-f]{16}$/),
        },
      },
    });
  });
});
