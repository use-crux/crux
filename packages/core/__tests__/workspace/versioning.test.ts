import { describe, expect, it } from "vitest";
import { inMemoryBlobStore, inMemoryDataStore, storage } from "../../storage";
import { workspace } from "../../workspace";

describe("workspace versioning & history", () => {
  it("records a newest-first version per content write", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      data: inMemoryDataStore(),
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
      data: inMemoryDataStore(),
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
      data: inMemoryDataStore(),
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
        data: inMemoryDataStore(),
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
      data: inMemoryDataStore(),
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
      data: inMemoryDataStore(),
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
      data: inMemoryDataStore(),
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
      data: inMemoryDataStore(),
    });

    await ws.write("/workspace/notes.md", "line one\nline two\nline three\n");
    await ws.write(
      "/workspace/notes.md",
      "line one\nline TWO\nline three\n",
    );

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
      data: inMemoryDataStore(),
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

  it("purges version history when a file is deleted", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      data: inMemoryDataStore(),
    });

    await ws.write("/workspace/notes.md", "v1");
    await ws.write("/workspace/notes.md", "v2");
    await ws.delete("/workspace/notes.md");

    expect(await ws.history("/workspace/notes.md")).toEqual([]);
  });

  it("exposes the undoWorkspaceFile tool only when opted in", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      data: inMemoryDataStore(),
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
