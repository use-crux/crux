import { afterEach, describe, expect, it, vi } from "vitest";
import { observe } from "../../../src/observability";
import { inMemoryAssetStore, inMemoryRecordStore } from "../../../src/storage";
import { workspace } from "../../../src/workspace";

afterEach(() => {
  vi.useRealTimers();
});

describe("workspace snapshot restore fidelity", () => {
  it("restores canonical inline JSON content", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });
    await ws.write("/outputs/data.json", {
      z: 1,
      nested: { b: 2, a: 1 },
    });
    const snapshot = await ws.snapshot.create({ path: "/outputs/data.json" });
    await ws.delete("/outputs/data.json");

    await expect(ws.snapshot.restore(snapshot)).resolves.toMatchObject({
      restoredFiles: 1,
    });
    await expect(ws.read("/outputs/data.json")).resolves.toMatchObject({
      kind: "json",
      content: { nested: { a: 1, b: 2 }, z: 1 },
    });
  });

  it("treats equivalent inline and asset storage as unchanged", async () => {
    const records = inMemoryRecordStore();
    const assets = inMemoryAssetStore();
    const inline = workspace({
      id: "research",
      namespace: "thread:1",
      records,
      assets,
    });
    await inline.write("/outputs/report.md", "same content");
    const snapshot = await inline.snapshot.create({
      path: "/outputs/report.md",
    });
    const assetBacked = workspace({
      id: "research",
      namespace: "thread:1",
      records,
      assets,
      content: { inlineTextBelowBytes: 0 },
    });
    await assetBacked.write("/outputs/report.md", "same content");

    await expect(assetBacked.snapshot.restore(snapshot)).resolves.toEqual({
      restoredFiles: 0,
      deletedFiles: 0,
      unchangedFiles: 1,
    });
    await expect(
      assetBacked.history("/outputs/report.md"),
    ).resolves.toHaveLength(2);
  });

  it("treats formatted asset JSON and equivalent inline JSON as unchanged", async () => {
    const records = inMemoryRecordStore();
    const assets = inMemoryAssetStore();
    const assetBacked = workspace({
      id: "research",
      namespace: "thread:1",
      records,
      assets,
    });
    await assetBacked.write(
      "/outputs/data.json",
      new TextEncoder().encode('{\n  "b": 2,\n  "a": 1\n}'),
      { mimeType: "application/json" },
    );
    const snapshot = await assetBacked.snapshot.create({
      path: "/outputs/data.json",
    });
    const inline = workspace({
      id: "research",
      namespace: "thread:1",
      records,
      assets,
    });
    await inline.write("/outputs/data.json", { a: 1, b: 2 });

    await expect(inline.snapshot.restore(snapshot)).resolves.toEqual({
      restoredFiles: 0,
      deletedFiles: 0,
      unchangedFiles: 1,
    });
    await expect(inline.history("/outputs/data.json")).resolves.toHaveLength(2);
  });

  it("restores exact non-UTF-8 bytes stored with a text MIME type", async () => {
    const records = inMemoryRecordStore();
    const assets = inMemoryAssetStore();
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records,
      assets,
    });
    await ws.write("/outputs/raw.txt", new Uint8Array([0xff]), {
      mimeType: "text/plain",
    });
    const snapshot = await ws.snapshot.create({ path: "/outputs/raw.txt" });
    await ws.delete("/outputs/raw.txt");

    await expect(ws.snapshot.restore(snapshot)).resolves.toMatchObject({
      restoredFiles: 1,
    });
    const restored = await ws.stat("/outputs/raw.txt");
    if (restored?.kind !== "file" || !restored.uri) {
      throw new Error("Expected asset-backed file.");
    }
    await expect(assets.get({ uri: restored.uri })).resolves.toMatchObject({
      data: new Uint8Array([0xff]),
    });
  });

  it("reuses exact asset-backed JSON strings and structured-suffix MIME", async () => {
    const records = inMemoryRecordStore();
    const assets = inMemoryAssetStore();
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records,
      assets,
      content: { inlineTextBelowBytes: 0 },
    });
    const captured = [
      {
        path: "/outputs/string.json",
        mimeType: "application/json",
        bytes: new TextEncoder().encode('"captured"'),
      },
      {
        path: "/outputs/problem.json",
        mimeType: "application/problem+json",
        bytes: new TextEncoder().encode('{"title":"captured"}'),
      },
    ] as const;
    for (const file of captured) {
      await ws.write(file.path, file.bytes, { mimeType: file.mimeType });
    }
    const snapshot = await ws.snapshot.create({ path: "/outputs" });
    for (const file of captured) {
      await ws.write(file.path, new TextEncoder().encode("null"), {
        mimeType: file.mimeType,
      });
    }

    await expect(ws.snapshot.restore(snapshot)).resolves.toEqual({
      restoredFiles: 2,
      deletedFiles: 0,
      unchangedFiles: 0,
    });
    for (const file of captured) {
      const restored = await ws.stat(file.path);
      if (restored?.kind !== "file" || !restored.uri) {
        throw new Error("Expected asset-backed JSON file.");
      }
      expect(restored.mimeType).toBe(file.mimeType);
      await expect(assets.get({ uri: restored.uri })).resolves.toMatchObject({
        data: file.bytes,
      });
    }
    await expect(ws.snapshot.restore(snapshot)).resolves.toEqual({
      restoredFiles: 0,
      deletedFiles: 0,
      unchangedFiles: 2,
    });
  });

  it("restores metadata, lifecycle fields, and provenance", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });
    const run = observe.openRun({
      name: "restore provenance",
      rootPrimitive: "custom.operation",
    });
    await run.withContext(() =>
      observe.span({ name: "producer", primitive: "custom.operation" }, () =>
        ws.write("/outputs/report.md", "captured", {
          mimeType: "text/markdown",
          metadata: { nested: { b: 2, a: 1 } },
          status: "draft",
          kind: "report",
        }),
      ),
    );
    run.end();
    const captured = await ws.read("/outputs/report.md");
    const snapshot = await ws.snapshot.create({ path: "/outputs/report.md" });
    await ws.write("/outputs/report.md", "later", {
      metadata: { state: "later" },
    });
    await ws.finalize("/outputs/report.md", { kind: "later-kind" });

    await expect(ws.snapshot.restore(snapshot)).resolves.toMatchObject({
      restoredFiles: 1,
    });
    await expect(ws.read("/outputs/report.md")).resolves.toMatchObject({
      content: "captured",
      mimeType: "text/markdown",
      metadata: { nested: { a: 1, b: 2 } },
      status: "draft",
      artifactKind: "report",
      producedBy: captured.producedBy,
    });
    await expect(ws.artifacts({ status: "final" })).resolves.toEqual([]);
  });

  it("clears artifact fields absent from an unpublished snapshot", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });
    await ws.write("/outputs/plain.md", "captured");
    const snapshot = await ws.snapshot.create({ path: "/outputs/plain.md" });
    await ws.finalize("/outputs/plain.md", { kind: "report" });

    await expect(ws.snapshot.restore(snapshot)).resolves.toMatchObject({
      restoredFiles: 1,
    });
    const restored = await ws.read("/outputs/plain.md");
    expect(restored).not.toHaveProperty("status");
    expect(restored).not.toHaveProperty("artifactKind");
    await expect(ws.artifacts({ status: "final" })).resolves.toEqual([]);
  });

  it("preserves captured creation time when recreating an absent path", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });
    await ws.write("/outputs/report.md", "captured");
    const captured = await ws.stat("/outputs/report.md");
    const snapshot = await ws.snapshot.create({ path: "/outputs/report.md" });
    await ws.delete("/outputs/report.md");
    vi.setSystemTime(3_000);

    await ws.snapshot.restore(snapshot);

    await expect(ws.stat("/outputs/report.md")).resolves.toMatchObject({
      createdAt: captured?.createdAt,
      updatedAt: 3_000,
    });
  });

  it("preserves live creation time when replacing an existing path", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });
    await ws.write("/outputs/report.md", "captured");
    const snapshot = await ws.snapshot.create({ path: "/outputs/report.md" });
    await ws.delete("/outputs/report.md");
    vi.setSystemTime(2_000);
    await ws.write("/outputs/report.md", "replacement");
    const live = await ws.stat("/outputs/report.md");
    vi.setSystemTime(3_000);

    await ws.snapshot.restore(snapshot);

    await expect(ws.stat("/outputs/report.md")).resolves.toMatchObject({
      createdAt: live?.createdAt,
      updatedAt: 3_000,
    });
  });
});
