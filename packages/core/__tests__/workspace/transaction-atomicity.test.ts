import { describe, expect, it, vi } from "vitest";
import {
  inMemoryAssetStore,
  inMemoryRecordStore,
  storage,
  type AssetStore,
} from "../../src/storage";
import { workspace } from "../../src/workspace";
import {
  failLiveNamespaceDelete,
  failLiveNamespacePut,
  failLiveNamespacePuts,
  failLiveNamespaceVersionPut,
} from "./transaction-test-helpers";

describe("workspace transaction atomicity", () => {
  it("restores path-one HEAD, history, and assets when path two fails", async () => {
    const records = inMemoryRecordStore();
    const assets = inMemoryAssetStore();
    const guarded = failLiveNamespacePut(records, {
      workspaceId: "research",
      namespace: "thread:1",
      onAttempt: 2,
    });
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      storage: storage({ records: guarded.records, assets }),
      versioning: { maxVersions: 1 },
    });
    await ws.write("/outputs/a.bin", new Uint8Array([1]), {
      mimeType: "application/octet-stream",
    });
    const before = await ws.read("/outputs/a.bin");
    if (before.kind !== "binary") throw new Error("expected binary file");

    guarded.enable();
    await expect(
      ws.transaction(async (tx) => {
        await tx.write("/outputs/a.bin", new Uint8Array([2, 2]), {
          mimeType: "application/octet-stream",
        });
        await tx.write("/outputs/b.bin", new Uint8Array([3, 3]), {
          mimeType: "application/octet-stream",
        });
      }),
    ).rejects.toThrow(/commit write failed/);

    await expect(ws.history("/outputs/a.bin")).resolves.toMatchObject([
      { version: 1, operation: "write", size: 1 },
    ]);
    await expect(ws.read("/outputs/a.bin")).resolves.toMatchObject({
      kind: "binary",
      uri: before.uri,
      size: 1,
    });
    await expect(assets.get({ uri: before.uri })).resolves.toMatchObject({
      size: 1,
    });
    await expect(ws.exists("/outputs/b.bin")).resolves.toBe(false);
  });

  it("restores HEAD and history when a version write fails", async () => {
    const records = inMemoryRecordStore();
    const guarded = failLiveNamespaceVersionPut(records, {
      workspaceId: "research",
      namespace: "thread:1",
      onAttempt: 1,
    });
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: guarded.records,
    });
    await ws.write("/outputs/report.md", "before");

    guarded.enable();
    await expect(
      ws.transaction((tx) => tx.write("/outputs/report.md", "after")),
    ).rejects.toThrow(/commit version write failed/);

    await expect(ws.read("/outputs/report.md")).resolves.toMatchObject({
      kind: "text",
      content: "before",
    });
    expect(await ws.history("/outputs/report.md")).toMatchObject([
      { version: 1, operation: "write", size: 6 },
    ]);
  });

  it("restores earlier puts and a planned delete when the delete fails", async () => {
    const records = inMemoryRecordStore();
    const guarded = failLiveNamespaceDelete(records, {
      workspaceId: "research",
      namespace: "thread:1",
      path: "/outputs/b.md",
    });
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: guarded.records,
    });
    await ws.write("/outputs/a.md", "a-before");
    await ws.write("/outputs/b.md", "b-before");

    guarded.enable();
    await expect(
      ws.transaction(async (tx) => {
        await tx.write("/outputs/a.md", "a-after");
        await tx.delete("/outputs/b.md");
      }),
    ).rejects.toThrow(/commit delete failed/);

    await expect(ws.read("/outputs/a.md")).resolves.toMatchObject({
      kind: "text",
      content: "a-before",
    });
    await expect(ws.read("/outputs/b.md")).resolves.toMatchObject({
      kind: "text",
      content: "b-before",
    });
    expect(await ws.history("/outputs/a.md")).toHaveLength(1);
    expect(await ws.history("/outputs/b.md")).toHaveLength(1);
  });

  it("validates namespace quota against the final batch state", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
      limits: { maxNamespaceBytes: 10 },
    });
    await ws.write("/outputs/z.md", "12345678");

    await ws.transaction(async (tx) => {
      await tx.delete("/outputs/z.md");
      await tx.write("/outputs/a.md", "1234567890");
    });

    await expect(ws.read("/outputs/a.md")).resolves.toMatchObject({
      kind: "text",
      content: "1234567890",
    });
    await expect(ws.exists("/outputs/z.md")).resolves.toBe(false);
  });

  it("keeps the original commit error primary when rollback also fails", async () => {
    const records = inMemoryRecordStore();
    const original = new Error("original path-two failure");
    const rollback = new Error("rollback metadata failure");
    const guarded = failLiveNamespacePuts(records, {
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
    await ws.write("/outputs/a.md", "before");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    guarded.enable();
    try {
      await expect(
        ws.transaction(async (tx) => {
          await tx.write("/outputs/a.md", "after");
          await tx.write("/outputs/b.md", "new");
        }),
      ).rejects.toBe(original);
      expect(warn).toHaveBeenCalledWith(
        expect.stringMatching(/rollback failed/),
        expect.arrayContaining([expect.any(AggregateError)]),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("does not reject after committed asset cleanup fails", async () => {
    const controlled = assetStoreWithDeleteFailure();
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      storage: storage({
        records: inMemoryRecordStore(),
        assets: controlled.store,
      }),
    });
    await ws.write("/outputs/report.bin", new Uint8Array([1]), {
      mimeType: "application/octet-stream",
    });
    const before = await ws.read("/outputs/report.bin");
    if (before.kind !== "binary") throw new Error("expected binary file");
    controlled.failDelete(before.uri);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      await expect(
        ws.transaction((tx) => tx.delete("/outputs/report.bin")),
      ).resolves.toBeUndefined();
      await expect(ws.exists("/outputs/report.bin")).resolves.toBe(false);
      await expect(ws.history("/outputs/report.bin")).resolves.toEqual([]);
      await expect(
        controlled.store.get({ uri: before.uri }),
      ).resolves.toMatchObject({
        size: 1,
      });
      expect(warn).toHaveBeenCalledWith(
        expect.stringMatching(/post-commit asset cleanup failed/),
        expect.objectContaining({ message: "asset cleanup failed" }),
      );
    } finally {
      warn.mockRestore();
    }
  });
});

function assetStoreWithDeleteFailure(): {
  readonly store: AssetStore;
  failDelete(uri: string): void;
} {
  const inner = inMemoryAssetStore();
  let failedUri: string | undefined;
  return {
    store: {
      put: inner.put,
      get: inner.get,
      delete: async (ref) => {
        if (ref.uri === failedUri) throw new Error("asset cleanup failed");
        await inner.delete(ref);
      },
    },
    failDelete: (uri) => {
      failedUri = uri;
    },
  };
}
