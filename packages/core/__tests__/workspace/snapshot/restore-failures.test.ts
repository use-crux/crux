import { describe, expect, it, vi } from "vitest";
import { inMemoryRecordStore } from "../../../src/storage";
import { workspace } from "../../../src/workspace";
import { failLiveNamespacePuts } from "../transaction-test-helpers";
import { controlledAssetStore, controlledRecordStore } from "./fixtures";

describe("workspace snapshot restore failures", () => {
  it("leaves an absent path untouched when destination asset put fails", async () => {
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
    const failure = new Error("destination asset put failed");
    const putCount = assets.putRefs.length;
    assets.failPuts(failure);

    await expect(ws.snapshot.restore(snapshot)).rejects.toMatchObject({
      code: "backend_error",
      snapshotId: snapshot.id,
      cause: failure,
    });
    expect(assets.putRefs).toHaveLength(putCount);
    await expect(ws.exists("/outputs/image.bin")).resolves.toBe(false);
    await expect(ws.history("/outputs/image.bin")).resolves.toEqual([]);
    await expect(ws.snapshot.list()).resolves.toEqual({
      snapshots: [snapshot],
    });
  });

  it("rolls path one back when path two HEAD persistence fails", async () => {
    const records = controlledRecordStore();
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: records.store,
    });
    await ws.write("/outputs/a.md", "captured-a");
    await ws.write("/outputs/b.md", "captured-b");
    const snapshot = await ws.snapshot.create({ path: "/outputs" });
    await ws.write("/outputs/a.md", "later-a");
    await ws.write("/outputs/b.md", "later-b");
    const failure = new Error("path two HEAD failed");
    records.failPutWhen(
      (value) =>
        value._cruxWorkspaceFile === true &&
        value.path === "/outputs/b.md" &&
        value.inlineText === "captured-b",
      failure,
    );

    await expect(ws.snapshot.restore(snapshot)).rejects.toMatchObject({
      code: "backend_error",
      cause: failure,
    });
    await expect(ws.read("/outputs/a.md")).resolves.toMatchObject({
      content: "later-a",
    });
    await expect(ws.read("/outputs/b.md")).resolves.toMatchObject({
      content: "later-b",
    });
    await expect(ws.history("/outputs/a.md")).resolves.toHaveLength(2);
    await expect(ws.history("/outputs/b.md")).resolves.toHaveLength(2);
  });

  it("cleans new assets and retains old assets after path two fails", async () => {
    const records = controlledRecordStore();
    const assets = controlledAssetStore();
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: records.store,
      assets: assets.store,
      content: { inlineTextBelowBytes: 0 },
    });
    await ws.write("/outputs/a.bin", new Uint8Array([1]));
    await ws.write("/outputs/b.bin", new Uint8Array([2]));
    const snapshot = await ws.snapshot.create({ path: "/outputs" });
    await ws.write("/outputs/a.bin", new Uint8Array([3]));
    await ws.write("/outputs/b.bin", new Uint8Array([4]));
    const laterA = await ws.read("/outputs/a.bin");
    const laterB = await ws.read("/outputs/b.bin");
    if (laterA.kind !== "binary" || laterB.kind !== "binary") {
      throw new Error("Expected binary content.");
    }
    const putCount = assets.putRefs.length;
    const failure = new Error("path two asset HEAD failed");
    records.failPutWhen(
      (value) =>
        value._cruxWorkspaceFile === true &&
        value.path === "/outputs/b.bin" &&
        value.headVersion === 3,
      failure,
    );

    await expect(ws.snapshot.restore(snapshot)).rejects.toMatchObject({
      code: "backend_error",
      cause: failure,
    });
    const introduced = assets.putRefs.slice(putCount);
    expect(introduced).toHaveLength(2);
    expect(assets.deletedRefs).toEqual(expect.arrayContaining(introduced));
    for (const ref of introduced) {
      await expect(assets.store.get(ref)).rejects.toMatchObject({
        code: "not_found",
      });
    }
    await expect(assets.store.get({ uri: laterA.uri })).resolves.toMatchObject({
      data: new Uint8Array([3]),
    });
    await expect(assets.store.get({ uri: laterB.uri })).resolves.toMatchObject({
      data: new Uint8Array([4]),
    });
  });

  it("restores HEAD and history when restore version persistence fails", async () => {
    const records = controlledRecordStore();
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: records.store,
    });
    await ws.write("/outputs/report.md", "captured");
    const snapshot = await ws.snapshot.create({ path: "/outputs/report.md" });
    await ws.write("/outputs/report.md", "later");
    const failure = new Error("restore version failed");
    records.failPutWhen(
      (value) =>
        value._cruxWorkspaceVersion === true && value.operation === "restore",
      failure,
    );

    await expect(ws.snapshot.restore(snapshot)).rejects.toMatchObject({
      code: "backend_error",
      cause: failure,
    });
    await expect(ws.read("/outputs/report.md")).resolves.toMatchObject({
      content: "later",
    });
    await expect(ws.history("/outputs/report.md")).resolves.toMatchObject([
      { version: 2, operation: "write" },
      { version: 1, operation: "write" },
    ]);
  });

  it("rolls replacements back when a planned later-file delete fails", async () => {
    const records = controlledRecordStore();
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: records.store,
    });
    await ws.write("/outputs/a.md", "captured-a");
    const snapshot = await ws.snapshot.create({ path: "/outputs" });
    await ws.write("/outputs/a.md", "later-a");
    await ws.write("/outputs/b.md", "later-b");
    const failure = new Error("planned delete failed");
    records.failDeleteWhen(
      (key) => key.includes(":file:") && key.includes("%2Foutputs%2Fb.md"),
      failure,
    );

    await expect(ws.snapshot.restore(snapshot)).rejects.toMatchObject({
      code: "backend_error",
      cause: failure,
    });
    await expect(ws.read("/outputs/a.md")).resolves.toMatchObject({
      content: "later-a",
    });
    await expect(ws.read("/outputs/b.md")).resolves.toMatchObject({
      content: "later-b",
    });
    await expect(ws.history("/outputs/a.md")).resolves.toHaveLength(2);
    await expect(ws.history("/outputs/b.md")).resolves.toHaveLength(1);
  });

  it("keeps the original failure primary when rollback metadata also fails", async () => {
    const original = new Error("original path two failure");
    const rollback = new Error("rollback metadata failure");
    const guarded = failLiveNamespacePuts(inMemoryRecordStore(), {
      workspaceId: "research",
      namespace: "thread:1",
      failures: new Map([
        [2, original],
        [3, rollback],
      ]),
    });
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: guarded.records,
    });
    await ws.write("/outputs/a.md", "captured-a");
    await ws.write("/outputs/b.md", "captured-b");
    const snapshot = await ws.snapshot.create({ path: "/outputs" });
    await ws.write("/outputs/a.md", "later-a");
    await ws.write("/outputs/b.md", "later-b");
    guarded.enable();

    await expect(ws.snapshot.restore(snapshot)).rejects.toMatchObject({
      code: "backend_error",
      cause: original,
    });
    await expect(ws.read("/outputs/a.md")).resolves.toMatchObject({
      content: "later-a",
    });
    await expect(ws.read("/outputs/b.md")).resolves.toMatchObject({
      content: "later-b",
    });
    await expect(ws.history("/outputs/a.md")).resolves.toHaveLength(2);
    await expect(ws.history("/outputs/b.md")).resolves.toHaveLength(2);
  });

  it("does not roll back a committed restore when retention cleanup fails", async () => {
    const assets = controlledAssetStore();
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
      assets: assets.store,
      content: { inlineTextBelowBytes: 0 },
      versioning: { maxVersions: 1 },
    });
    await ws.write("/outputs/image.bin", new Uint8Array([1]));
    const snapshot = await ws.snapshot.create({ path: "/outputs/image.bin" });
    await ws.write("/outputs/image.bin", new Uint8Array([2]));
    const later = await ws.read("/outputs/image.bin");
    if (later.kind !== "binary") throw new Error("Expected binary content.");
    assets.failDelete(
      { uri: later.uri },
      new Error("retention cleanup failed"),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      await expect(ws.snapshot.restore(snapshot)).resolves.toMatchObject({
        restoredFiles: 1,
      });
      const restored = await ws.read("/outputs/image.bin");
      if (restored.kind !== "binary")
        throw new Error("Expected binary content.");
      await expect(
        assets.store.get({ uri: restored.uri }),
      ).resolves.toMatchObject({
        data: new Uint8Array([1]),
      });
      await expect(assets.store.get({ uri: later.uri })).resolves.toMatchObject(
        {
          data: new Uint8Array([2]),
        },
      );
      await expect(ws.history("/outputs/image.bin")).resolves.toMatchObject([
        { version: 3, operation: "restore" },
      ]);
      expect(warn).toHaveBeenCalledWith(
        expect.stringMatching(/post-commit retention failed/),
        expect.objectContaining({ message: "retention cleanup failed" }),
      );
    } finally {
      warn.mockRestore();
    }
  });
});
