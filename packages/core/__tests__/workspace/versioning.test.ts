import { describe, expect, it, vi } from "vitest";
import {
  inMemoryBlobStore,
  inMemoryRecordStore,
  storage,
  type RecordStore,
  type JsonObject,
  type RecordWriteOptions,
} from "../../src/storage";
import { workspace } from "../../src/workspace";

describe("workspace versioning & history", () => {
  it("records a newest-first version per content write", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });

    await ws.write("/workspace/notes.md", "first");
    await ws.write("/workspace/notes.md", "second");

    const history = await ws.history("/workspace/notes.md");

    expect(history.map((entry) => entry.version)).toEqual([2, 1]);
    expect(history[0]).toMatchObject({
      version: 2,
      path: "/workspace/notes.md",
      operation: "write",
    });
  });

  it("reads a specific historical revision via { version }", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });

    await ws.write("/workspace/notes.md", "first");
    await ws.write("/workspace/notes.md", "second");

    const v1 = await ws.read("/workspace/notes.md", { version: 1 });
    const current = await ws.read("/workspace/notes.md");

    expect(v1).toMatchObject({ kind: "text", content: "first" });
    expect(current).toMatchObject({ kind: "text", content: "second" });
  });

  it("throws when reading a version that does not exist", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });

    await ws.write("/workspace/notes.md", "first");

    await expect(
      ws.read("/workspace/notes.md", { version: 9 }),
    ).rejects.toThrow(/version 9 .* was not found/i);
  });

  it("versions blob-backed text without clobbering older revisions", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      storage: storage({
        records: inMemoryRecordStore(),
        blobs: inMemoryBlobStore(),
      }),
      content: { inlineTextBelowBytes: 4 },
    });

    await ws.write("/workspace/big.md", "AAAAAAAAAA", {
      mimeType: "text/markdown",
    });
    await ws.write("/workspace/big.md", "BBBBBBBBBB", {
      mimeType: "text/markdown",
    });

    const v1 = await ws.read("/workspace/big.md", { version: 1 });
    const v2 = await ws.read("/workspace/big.md", { version: 2 });

    expect(v1).toMatchObject({ kind: "text", content: "AAAAAAAAAA" });
    expect(v2).toMatchObject({ kind: "text", content: "BBBBBBBBBB" });
  });

  it("records edit and append as distinct versioned operations", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });

    await ws.write("/workspace/notes.md", "alpha\n");
    await ws.edit("/workspace/notes.md", { find: "alpha", replace: "beta" });
    await ws.append("/workspace/notes.md", "gamma\n");

    const history = await ws.history("/workspace/notes.md");

    expect(history.map((entry) => entry.operation)).toEqual([
      "append",
      "edit",
      "write",
    ]);
  });

  it("undo reverts the last edit by appending the previous content as a new version", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });

    await ws.write("/workspace/notes.md", "original");
    await ws.edit("/workspace/notes.md", {
      find: "original",
      replace: "broken",
    });

    const restored = await ws.undo("/workspace/notes.md");
    const current = await ws.read("/workspace/notes.md");
    const history = await ws.history("/workspace/notes.md");

    expect(current).toMatchObject({ kind: "text", content: "original" });
    expect(restored).toMatchObject({ kind: "file", size: 8 });
    // History grows — undo never rewrites it.
    expect(history.map((entry) => entry.operation)).toEqual([
      "undo",
      "edit",
      "write",
    ]);
  });

  it("throws on undo when there is no earlier version", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });

    await ws.write("/workspace/notes.md", "only");

    await expect(ws.undo("/workspace/notes.md")).rejects.toThrow(
      /no earlier version/i,
    );
  });

  it("diffs two revisions as a unified string and structured hunks", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });

    await ws.write("/workspace/notes.md", "line one\nline two\nline three\n");
    await ws.write("/workspace/notes.md", "line one\nline TWO\nline three\n");

    const diff = await ws.diff("/workspace/notes.md");

    expect(diff).toMatchObject({ from: 1, to: 2 });
    expect(diff.unified).toContain("-line two");
    expect(diff.unified).toContain("+line TWO");
    expect(diff.hunks).toHaveLength(1);
    expect(diff.hunks[0]!.lines).toEqual([
      { kind: "context", text: "line one" },
      { kind: "remove", text: "line two" },
      { kind: "add", text: "line TWO" },
      { kind: "context", text: "line three" },
    ]);
  });

  it("retains only the most recent versions when maxVersions is set", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
      versioning: { maxVersions: 2 },
    });

    await ws.write("/workspace/notes.md", "v1");
    await ws.write("/workspace/notes.md", "v2");
    await ws.write("/workspace/notes.md", "v3");

    const history = await ws.history("/workspace/notes.md");

    expect(history.map((entry) => entry.version)).toEqual([3, 2]);
    await expect(
      ws.read("/workspace/notes.md", { version: 1 }),
    ).rejects.toThrow(/version 1 .* was not found/i);
  });

  it("honors an explicit history limit of zero", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });

    await ws.write("/workspace/notes.md", "v1");

    await expect(
      ws.history("/workspace/notes.md", { limit: 0 }),
    ).resolves.toEqual([]);
  });

  it("rolls back the live record when version persistence fails", async () => {
    const records = inMemoryRecordStore();
    let failVersionWrite = false;
    const guardedRecords: RecordStore = {
      ...records,
      async put(
        key: string,
        value: JsonObject,
        options?: RecordWriteOptions,
      ): Promise<void> {
        if (failVersionWrite && key.includes(":version:")) {
          throw new Error("version write failed");
        }
        await records.put(key, value, options);
      },
    };
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: guardedRecords,
    });

    await ws.write("/workspace/notes.md", "v1");
    failVersionWrite = true;

    await expect(ws.write("/workspace/notes.md", "v2")).rejects.toThrow(
      /version write failed/,
    );
    await expect(ws.read("/workspace/notes.md")).resolves.toMatchObject({
      kind: "text",
      content: "v1",
    });
    expect(
      (await ws.history("/workspace/notes.md")).map((entry) => entry.version),
    ).toEqual([1]);
  });

  it("purges version history when a file is deleted", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });

    await ws.write("/workspace/notes.md", "v1");
    await ws.write("/workspace/notes.md", "v2");
    await ws.delete("/workspace/notes.md");

    expect(await ws.history("/workspace/notes.md")).toEqual([]);
  });

  it("preserves blob payloads when deleteBlob is false", async () => {
    const blobs = inMemoryBlobStore();
    const deleteBlob = vi.spyOn(blobs, "delete");
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      storage: storage({ records: inMemoryRecordStore(), blobs }),
    });

    await ws.write("/workspace/file.bin", new Uint8Array([1]), {
      mimeType: "application/octet-stream",
    });
    const first = await ws.read("/workspace/file.bin");
    await ws.write("/workspace/file.bin", new Uint8Array([2]), {
      mimeType: "application/octet-stream",
    });
    const second = await ws.read("/workspace/file.bin");
    if (first.kind !== "binary" || second.kind !== "binary") {
      throw new Error("expected binary reads");
    }

    await ws.delete("/workspace/file.bin", { deleteBlob: false });

    expect(deleteBlob).not.toHaveBeenCalled();
    await expect(blobs.get(first.uri)).resolves.toMatchObject({
      mimeType: "application/octet-stream",
    });
    await expect(blobs.get(second.uri)).resolves.toMatchObject({
      mimeType: "application/octet-stream",
    });
  });

  it("deletes each blob-backed version once when a file is deleted", async () => {
    const blobs = inMemoryBlobStore();
    const deleteBlob = vi.spyOn(blobs, "delete");
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      storage: storage({ records: inMemoryRecordStore(), blobs }),
    });

    await ws.write("/workspace/file.bin", new Uint8Array([1]), {
      mimeType: "application/octet-stream",
    });
    const first = await ws.read("/workspace/file.bin");
    await ws.write("/workspace/file.bin", new Uint8Array([2]), {
      mimeType: "application/octet-stream",
    });
    const second = await ws.read("/workspace/file.bin");
    if (first.kind !== "binary" || second.kind !== "binary") {
      throw new Error("expected binary reads");
    }

    await ws.delete("/workspace/file.bin");

    expect(deleteBlob.mock.calls.map(([uri]) => uri).sort()).toEqual(
      [first.uri, second.uri].sort(),
    );
  });

  it("reseeds copied files with fresh destination history", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });

    await ws.write("/workspace/source.md", "v1");
    await ws.write("/workspace/source.md", "v2");
    await ws.copy("/workspace/source.md", "/workspace/copy.md");
    await ws.write("/workspace/copy.md", "v3");

    await expect(
      ws.read("/workspace/copy.md", { version: 1 }),
    ).resolves.toMatchObject({ kind: "text", content: "v2" });
    expect(
      (await ws.history("/workspace/copy.md")).map((entry) => entry.version),
    ).toEqual([2, 1]);
  });

  it("reseeds moved files with fresh destination history and purges source history", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });

    await ws.write("/workspace/source.md", "v1");
    await ws.write("/workspace/source.md", "v2");
    await ws.move("/workspace/source.md", "/workspace/moved.md");
    await ws.write("/workspace/moved.md", "v3");

    await expect(
      ws.read("/workspace/moved.md", { version: 1 }),
    ).resolves.toMatchObject({ kind: "text", content: "v2" });
    await expect(ws.history("/workspace/source.md")).resolves.toEqual([]);
  });

  it("rejects exact diffs that would allocate an unbounded LCS matrix", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });
    const before = Array.from({ length: 1001 }, (_, index) => `a${index}`).join(
      "\n",
    );
    const after = Array.from({ length: 1001 }, (_, index) => `b${index}`).join(
      "\n",
    );

    await ws.write("/workspace/large.md", before);
    await ws.write("/workspace/large.md", after);

    await expect(ws.diff("/workspace/large.md")).rejects.toThrow(/too large/);
  });

  it("exposes the undoWorkspaceFile tool only when opted in", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });

    expect(ws.asTools()).not.toHaveProperty("undoWorkspaceFile");

    const tools = ws.asTools({ undo: true });
    expect(tools).toHaveProperty("undoWorkspaceFile");

    await ws.write("/workspace/notes.md", "first");
    await ws.write("/workspace/notes.md", "second");
    await tools.undoWorkspaceFile.execute(
      { path: "/workspace/notes.md" },
      {} as never,
    );

    const current = await ws.read("/workspace/notes.md");
    expect(current).toMatchObject({ kind: "text", content: "first" });
  });
});
