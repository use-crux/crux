import { describe, expect, it } from "vitest";
import { inMemoryBlobStore, inMemoryDataStore, storage } from "../../storage";
import { workspace, workspaceToolNames } from "../../workspace";

describe("workspace filesystem operations", () => {
  it("checks whether a file exists in the selected namespace", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:default",
      data: inMemoryDataStore(),
    });

    await ws.write("/workspace/notes.md", "default notes");
    await ws.write("/workspace/notes.md", "override notes", {
      namespace: "thread:override",
    });

    await expect(ws.exists("/workspace/notes.md")).resolves.toBe(true);
    await expect(ws.exists("/workspace/missing.md")).resolves.toBe(false);
    await expect(
      ws.exists("/workspace/notes.md", { namespace: "thread:override" }),
    ).resolves.toBe(true);
    await expect(
      ws.exists("/workspace/default-only.md", { namespace: "thread:override" }),
    ).resolves.toBe(false);
  });

  it("returns file metadata without content when statting a file", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:default",
      data: inMemoryDataStore(),
    });

    await ws.write("/workspace/notes.md", "private notes", {
      metadata: { source: "user" },
      mimeType: "text/markdown",
    });

    const stat = await ws.stat("/workspace/notes.md");

    expect(stat).toMatchObject({
      kind: "file",
      path: "/workspace/notes.md",
      mimeType: "text/markdown",
      size: 13,
      storage: "inline",
      metadata: { source: "user" },
    });
    expect(stat).not.toHaveProperty("content");
    expect(stat).not.toHaveProperty("inlineText");
    await expect(ws.stat("/workspace/missing.md")).resolves.toBeNull();
  });

  it("appends text, creates missing files, and rejects binary files", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:default",
      storage: storage({
        data: inMemoryDataStore(),
        blobs: inMemoryBlobStore(),
      }),
    });

    await ws.write("/workspace/notes.md", "alpha", {
      mimeType: "text/markdown",
    });
    await ws.append("/workspace/notes.md", "\nbeta");
    await ws.append("/workspace/new.md", "created");
    await ws.write("/outputs/report.pdf", new Uint8Array([1, 2, 3]), {
      mimeType: "application/pdf",
    });

    await expect(ws.read("/workspace/notes.md")).resolves.toMatchObject({
      kind: "text",
      content: "alpha\nbeta",
      mimeType: "text/markdown",
    });
    await expect(ws.read("/workspace/new.md")).resolves.toMatchObject({
      kind: "text",
      content: "created",
    });
    await expect(ws.append("/outputs/report.pdf", "nope")).rejects.toThrow(
      /only text files/i,
    );
  });

  it("renames files with metadata, overwrite checks, and mount access rules", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:default",
      storage: storage({
        data: inMemoryDataStore(),
        blobs: inMemoryBlobStore(),
      }),
      mounts: [
        { path: "/workspace", access: "readwrite" },
        { path: "/archive", access: "read" },
      ],
    });

    await ws.write("/workspace/source.md", "source", {
      metadata: { tag: "draft" },
      status: "draft",
      kind: "report",
    });
    await ws.write("/workspace/existing.md", "existing");

    await expect(
      ws.rename("/workspace/source.md", "/workspace/existing.md"),
    ).rejects.toThrow(/already exists/i);
    const moved = await ws.rename(
      "/workspace/source.md",
      "/workspace/moved.md",
    );

    expect(moved).toMatchObject({
      path: "/workspace/moved.md",
      metadata: { tag: "draft" },
      status: "draft",
      artifactKind: "report",
    });
    await expect(ws.exists("/workspace/source.md")).resolves.toBe(false);
    await expect(ws.read("/workspace/moved.md")).resolves.toMatchObject({
      kind: "text",
      content: "source",
    });

    await ws.write("/workspace/next.md", "next", {
      namespace: "thread:override",
    });
    await ws.move("/workspace/next.md", "/workspace/done.md", {
      namespace: "thread:override",
    });
    await expect(
      ws.exists("/workspace/done.md", { namespace: "thread:override" }),
    ).resolves.toBe(true);

    await expect(
      ws.rename("/workspace/moved.md", "/workspace/existing.md", {
        overwrite: true,
      }),
    ).resolves.toMatchObject({
      path: "/workspace/existing.md",
    });
    await expect(
      ws.rename("/workspace/existing.md", "/archive/existing.md"),
    ).rejects.toThrow(/read-only/i);
  });

  it("treats same-path rename as a no-op and records move separately", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:default",
      data: inMemoryDataStore(),
    });

    await ws.write("/workspace/source.md", "source");
    await expect(
      ws.rename("/workspace/source.md", "/workspace/source.md"),
    ).resolves.toMatchObject({
      path: "/workspace/source.md",
    });
    await expect(ws.read("/workspace/source.md")).resolves.toMatchObject({
      kind: "text",
      content: "source",
    });
    await expect(
      ws.move("/workspace/source.md", "/workspace/moved.md"),
    ).resolves.toMatchObject({
      path: "/workspace/moved.md",
    });
  });

  it("copies files while preserving readable content and metadata", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:default",
      storage: storage({
        data: inMemoryDataStore(),
        blobs: inMemoryBlobStore(),
      }),
      content: { inlineTextBelowBytes: 4 },
    });

    await ws.write("/workspace/source.md", "blob-backed text", {
      metadata: { owner: "agent" },
      mimeType: "text/markdown",
    });
    await ws.write("/workspace/existing.md", "existing");

    await expect(
      ws.copy("/workspace/source.md", "/workspace/existing.md"),
    ).rejects.toThrow(/already exists/i);
    const copied = await ws.copy("/workspace/source.md", "/workspace/copy.md");

    expect(copied).toMatchObject({
      path: "/workspace/copy.md",
      storage: "blob",
      metadata: { owner: "agent" },
    });
    await expect(ws.read("/workspace/source.md")).resolves.toMatchObject({
      kind: "text",
      content: "blob-backed text",
    });
    await expect(ws.read("/workspace/copy.md")).resolves.toMatchObject({
      kind: "text",
      content: "blob-backed text",
    });
  });

  it("greps scoped text files with line, column, and result caps", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:default",
      storage: storage({
        data: inMemoryDataStore(),
        blobs: inMemoryBlobStore(),
      }),
      content: { inlineTextBelowBytes: 4 },
    });

    await ws.write("/workspace/a.md", "first needle\nsecond Needle");
    await ws.write("/workspace/nested/b.md", "needle blob\nneedle again");
    await ws.write("/outputs/report.md", "needle outside");

    await expect(
      ws.grep("needle", { path: "/workspace/**/*.md", maxResults: 2 }),
    ).resolves.toEqual({
      matches: [
        { path: "/workspace/a.md", line: 1, column: 7, text: "first needle" },
        {
          path: "/workspace/nested/b.md",
          line: 1,
          column: 1,
          text: "needle blob",
        },
      ],
    });
    await expect(
      ws.grep("needle", { path: "/workspace/a.md", ignoreCase: true }),
    ).resolves.toMatchObject({
      matches: [
        { line: 1, column: 7 },
        { line: 2, column: 8 },
      ],
    });
  });

  it("treats grep queries as literals unless regex is explicitly enabled", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:default",
      data: inMemoryDataStore(),
    });

    await ws.write("/workspace/a.md", "a.*b\na123b");

    await expect(ws.grep("a.*b")).resolves.toEqual({
      matches: [{ path: "/workspace/a.md", line: 1, column: 1, text: "a.*b" }],
    });
    await expect(ws.grep("a.*b", { regex: true })).resolves.toEqual({
      matches: [
        { path: "/workspace/a.md", line: 1, column: 1, text: "a.*b" },
        { path: "/workspace/a.md", line: 2, column: 1, text: "a123b" },
      ],
    });
  });

  it("injects rename and grep tools with default and prefixed names", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:default",
      data: inMemoryDataStore(),
    });
    const tools = ws.asTools();

    expect(Object.keys(tools).sort()).toEqual([
      "editWorkspaceFile",
      "grepWorkspace",
      "listWorkspace",
      "readWorkspaceFile",
      "renameWorkspaceFile",
      "writeWorkspaceFile",
    ]);
    expect(workspaceToolNames()).toMatchObject({
      renameFile: "renameWorkspaceFile",
      grep: "grepWorkspace",
    });
    expect(workspaceToolNames({ prefix: "research" })).toMatchObject({
      renameFile: "renameResearchWorkspaceFile",
      grep: "grepResearchWorkspace",
    });

    await tools.writeWorkspaceFile.execute?.({
      path: "/workspace/source.md",
      content: "needle",
    });
    await tools.renameWorkspaceFile.execute?.({
      from: "/workspace/source.md",
      to: "/workspace/done.md",
    });

    await expect(
      tools.grepWorkspace.execute?.({
        query: "needle",
        path: "/workspace/**/*.md",
      }),
    ).resolves.toEqual({
      matches: [
        { path: "/workspace/done.md", line: 1, column: 1, text: "needle" },
      ],
    });
  });
});
