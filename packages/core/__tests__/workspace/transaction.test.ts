import { describe, expect, it, vi } from "vitest";
import {
  inMemoryBlobStore,
  inMemoryRecordStore,
  storage,
} from "../../storage";
import { workspace, type WorkspaceCustomMountSource } from "../../workspace";
import {
  failLiveNamespacePut,
  failStagingNamespacePut,
} from "./transaction-test-helpers";

describe("workspace transactions", () => {
  it("commits multiple workspace writes as one operation", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });

    await ws.transaction(async (tx) => {
      await tx.write("/outputs/report.md", "# Report");
      await tx.write("/outputs/data.csv", "name,value\nalpha,1\n");
    });

    await expect(ws.read("/outputs/report.md")).resolves.toMatchObject({
      kind: "text",
      content: "# Report",
    });
    await expect(ws.read("/outputs/data.csv")).resolves.toMatchObject({
      kind: "text",
      content: "name,value\nalpha,1\n",
    });
  });

  it("discards staged writes when the callback throws", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });

    await expect(
      ws.transaction(async (tx) => {
        await tx.write("/outputs/report.md", "# Draft");
        await tx.write("/outputs/data.csv", "name,value\nalpha,1\n");
        throw new Error("generation failed");
      }),
    ).rejects.toThrow(/generation failed/);

    await expect(ws.exists("/outputs/report.md")).resolves.toBe(false);
    await expect(ws.exists("/outputs/data.csv")).resolves.toBe(false);
  });

  it("rolls back live writes when commit fails part-way through", async () => {
    const records = inMemoryRecordStore();
    const guarded = failLiveNamespacePut(records, {
      workspaceId: "research",
      namespace: "thread:1",
      onAttempt: 2,
    });
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: guarded.records,
    });

    guarded.enable();
    await expect(
      ws.transaction(async (tx) => {
        await tx.write("/outputs/report.md", "# Draft");
        await tx.write("/outputs/data.csv", "name,value\nalpha,1\n");
      }),
    ).rejects.toThrow(/commit write failed/);

    await expect(ws.exists("/outputs/report.md")).resolves.toBe(false);
    await expect(ws.exists("/outputs/data.csv")).resolves.toBe(false);
  });

  it("cleans staged files when seeding fails", async () => {
    const records = inMemoryRecordStore();
    const guarded = failStagingNamespacePut(records, { onAttempt: 2 });
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: guarded.records,
    });
    await ws.write("/workspace/one.md", "one");
    await ws.write("/workspace/two.md", "two");

    guarded.enable();
    await expect(ws.transaction(async () => undefined)).rejects.toThrow(
      /staging write failed/,
    );

    const listed = await records.list("workspace:research:");
    expect(listed.entries.every((entry) => !entry.key.includes(".__crux_tx_")))
      .toBe(true);
  });

  it("commits blob-backed files through the transaction", async () => {
    const blobs = inMemoryBlobStore();
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      storage: storage({
        records: inMemoryRecordStore(),
        blobs,
      }),
    });

    await ws.transaction(async (tx) => {
      await tx.write("/outputs/report.bin", new Uint8Array([1, 2, 3]), {
        mimeType: "application/octet-stream",
      });
    });

    const file = await ws.read("/outputs/report.bin");
    expect(file).toMatchObject({
      kind: "binary",
      size: 3,
      mimeType: "application/octet-stream",
    });
    if (file.kind !== "binary") throw new Error("expected binary file");
    await expect(blobs.get(file.uri)).resolves.toMatchObject({ size: 3 });
  });

  it("restores blob-backed files when commit fails part-way through", async () => {
    const records = inMemoryRecordStore();
    const blobs = inMemoryBlobStore();
    const deleteBlob = vi.spyOn(blobs, "delete");
    const guarded = failLiveNamespacePut(records, {
      workspaceId: "research",
      namespace: "thread:1",
      onAttempt: 2,
    });
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      storage: storage({ records: guarded.records, blobs }),
    });
    await ws.write("/outputs/report.bin", new Uint8Array([1]), {
      mimeType: "application/octet-stream",
    });
    const before = await ws.read("/outputs/report.bin");
    if (before.kind !== "binary") throw new Error("expected binary file");

    guarded.enable();
    await expect(
      ws.transaction(async (tx) => {
        await tx.write("/outputs/report.bin", new Uint8Array([2, 2]), {
          mimeType: "application/octet-stream",
        });
        await tx.write("/outputs/data.bin", new Uint8Array([3, 3]), {
          mimeType: "application/octet-stream",
        });
      }),
    ).rejects.toThrow(/commit write failed/);

    await expect(ws.read("/outputs/report.bin")).resolves.toMatchObject({
      kind: "binary",
      uri: before.uri,
      size: 1,
    });
    await expect(blobs.get(before.uri)).resolves.toMatchObject({ size: 1 });
    const deletedUris = deleteBlob.mock.calls.map(([uri]) => uri);
    expect(deletedUris).not.toContain(before.uri);
    const transactionCreatedUris = deletedUris.filter((uri) => uri !== before.uri);
    expect(transactionCreatedUris.length).toBeGreaterThan(0);
    for (const uri of new Set(transactionCreatedUris)) {
      await expect(blobs.head(uri)).resolves.toBeNull();
    }
    await expect(ws.exists("/outputs/data.bin")).resolves.toBe(false);
  });

  it("cleans pre-commit blobs after a successful transaction delete", async () => {
    const blobs = inMemoryBlobStore();
    const deleteBlob = vi.spyOn(blobs, "delete");
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      storage: storage({ records: inMemoryRecordStore(), blobs }),
    });
    await ws.write("/outputs/report.bin", new Uint8Array([1]), {
      mimeType: "application/octet-stream",
    });
    const before = await ws.read("/outputs/report.bin");
    if (before.kind !== "binary") throw new Error("expected binary file");

    await ws.transaction(async (tx) => {
      await tx.delete("/outputs/report.bin");
    });

    await expect(ws.exists("/outputs/report.bin")).resolves.toBe(false);
    expect(deleteBlob).toHaveBeenCalledWith(before.uri);
    await expect(blobs.head(before.uri)).resolves.toBeNull();
  });

  it("gives the callback a staged view and commits the final staged content", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });
    await ws.write("/workspace/notes.md", "alpha");

    await ws.transaction(async (tx) => {
      await tx.edit("/workspace/notes.md", {
        find: "alpha",
        replace: "beta",
      });
      await expect(tx.read("/workspace/notes.md")).resolves.toMatchObject({
        kind: "text",
        content: "beta",
      });
      await expect(ws.read("/workspace/notes.md")).resolves.toMatchObject({
        kind: "text",
        content: "alpha",
      });
    });

    await expect(ws.read("/workspace/notes.md")).resolves.toMatchObject({
      kind: "text",
      content: "beta",
    });
  });

  it("returns the callback result after committing", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });

    const artifact = await ws.transaction(async (tx) => {
      await tx.write("/outputs/report.md", "# Report", {
        status: "draft",
      });
      return tx.finalize("/outputs/report.md", { kind: "report" });
    });

    expect(artifact).toMatchObject({
      path: "/outputs/report.md",
      status: "final",
      kind: "report",
    });
    await expect(ws.artifacts()).resolves.toMatchObject([
      {
        path: "/outputs/report.md",
        status: "final",
        kind: "report",
      },
    ]);
  });

  it("rejects transaction writes to source-backed mounts", async () => {
    const write = vi.fn();
    const source: WorkspaceCustomMountSource = {
      kind: "custom",
      list: () => ({ entries: [] }),
      read: () => null,
      write,
    };
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
      mounts: [
        { path: "/workspace", access: "readwrite" },
        { path: "/sources", access: "readwrite", source },
      ],
    });

    await expect(
      ws.transaction((tx) => tx.write("/sources/report.md", "# Report")),
    ).rejects.toThrow(/source-backed mount.*transaction/i);
    expect(write).not.toHaveBeenCalled();
  });
});
