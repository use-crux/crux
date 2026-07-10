import { describe, expect, it } from "vitest";
import { inMemoryRecordStore } from "../../src/storage";
import { workspace } from "../../src/workspace";

describe("workspace writeable virtual mounts", () => {
  it("delegates write, edit, append, and delete to opt-in custom sources", async () => {
    const files = new Map<
      string,
      { readonly content: string; readonly metadata?: Record<string, unknown> }
    >();
    const operations: string[] = [];
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
      mounts: [
        {
          path: "/sources",
          access: "readwrite",
          source: {
            kind: "custom",
            list: async () => ({ entries: [] }),
            read: async (path) => {
              const file = files.get(path);
              if (!file) return null;
              return {
                kind: "text",
                path,
                mimeType: "text/markdown",
                content: file.content,
                size: new TextEncoder().encode(file.content).byteLength,
                metadata: file.metadata,
              };
            },
            write: async (path, content, options) => {
              operations.push(options?.operation ?? "unknown");
              if (typeof content !== "string") {
                throw new Error("test source only accepts text content");
              }
              files.set(path, {
                content,
                metadata: options?.metadata,
              });
              return {
                kind: "file",
                path,
                mount: "/provider/native-root",
                mimeType: options?.mimeType ?? "text/plain",
                size: new TextEncoder().encode(content).byteLength,
                storage: "inline",
                metadata: options?.metadata,
                createdAt: 1,
                updatedAt: 2,
              };
            },
            delete: async (path) => {
              files.delete(path);
            },
          },
        },
      ],
    });

    await expect(
      ws.write("/sources/brief.md", "draft", {
        mimeType: "text/markdown",
        metadata: { title: "Brief" },
      }),
    ).resolves.toMatchObject({
      path: "/sources/brief.md",
      mount: "/sources",
      storage: "virtual",
      metadata: { title: "Brief" },
    });

    await expect(
      ws.edit("/sources/brief.md", { find: "draft", replace: "final" }),
    ).resolves.toMatchObject({
      path: "/sources/brief.md",
      storage: "virtual",
    });
    await expect(ws.append("/sources/brief.md", "\nmore")).resolves.toMatchObject(
      {
        path: "/sources/brief.md",
        storage: "virtual",
      },
    );
    await expect(ws.read("/sources/brief.md")).resolves.toMatchObject({
      kind: "text",
      content: "final\nmore",
    });

    await ws.delete("/sources/brief.md");
    await expect(ws.read("/sources/brief.md")).rejects.toThrow(
      /workspace file not found/i,
    );
    expect(operations).toEqual(["write", "edit", "append"]);
  });

  it("still rejects writes when the source or mount access does not opt in", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
      mounts: [
        {
          path: "/readonly",
          access: "read",
          source: {
            kind: "custom",
            list: async () => ({ entries: [] }),
            read: async () => null,
            write: async () => undefined,
          },
        },
        {
          path: "/unimplemented",
          access: "readwrite",
          source: {
            kind: "custom",
            list: async () => ({ entries: [] }),
            read: async () => null,
          },
        },
      ],
    });

    await expect(ws.write("/readonly/brief.md", "draft")).rejects.toThrow(
      /read-only/i,
    );
    await expect(
      ws.write("/unimplemented/brief.md", "draft"),
    ).rejects.toThrow(/source-backed mount.*write/i);
  });

  it("copies local files into provider-backed destinations with write hooks", async () => {
    const files = new Map<string, string>();
    const operations: string[] = [];
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
      mounts: [
        { path: "/workspace", access: "readwrite" },
        {
          path: "/sources",
          access: "readwrite",
          source: {
            kind: "custom",
            list: async () => ({ entries: [] }),
            read: async (path) => {
              const content = files.get(path);
              if (!content) return null;
              return {
                kind: "text",
                path,
                mimeType: "text/markdown",
                content,
                size: new TextEncoder().encode(content).byteLength,
              };
            },
            exists: async (path) => files.has(path),
            write: async (path, content, options) => {
              operations.push(options?.operation ?? "unknown");
              if (typeof content !== "string") {
                throw new Error("test source only accepts text content");
              }
              files.set(path, content);
              return {
                kind: "file",
                path,
                mount: "/sources",
                mimeType: options?.mimeType ?? "text/plain",
                size: new TextEncoder().encode(content).byteLength,
                storage: "virtual",
                createdAt: 1,
                updatedAt: 2,
              };
            },
          },
        },
      ],
    });

    await ws.write("/workspace/brief.md", "local brief", {
      mimeType: "text/markdown",
    });

    await expect(
      ws.copy("/workspace/brief.md", "/sources/brief.md"),
    ).resolves.toMatchObject({
      path: "/sources/brief.md",
      mount: "/sources",
      storage: "virtual",
      mimeType: "text/markdown",
    });
    await expect(ws.read("/sources/brief.md")).resolves.toMatchObject({
      kind: "text",
      content: "local brief",
    });
    await expect(
      ws.copy("/workspace/brief.md", "/sources/brief.md"),
    ).rejects.toThrow(/destination file already exists/i);
    await expect(
      ws.copy("/workspace/brief.md", "/sources/brief.md", {
        overwrite: true,
      }),
    ).resolves.toMatchObject({ path: "/sources/brief.md" });
    expect(operations).toEqual(["copy", "copy"]);
  });

  it("rejects appends when the provider read is truncated", async () => {
    let wrote = false;
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
      mounts: [
        {
          path: "/sources",
          access: "readwrite",
          source: {
            kind: "custom",
            list: async () => ({ entries: [] }),
            read: async (path) => ({
              kind: "text",
              path,
              mimeType: "text/markdown",
              content: "partial",
              size: 100,
              truncated: true,
            }),
            write: async () => {
              wrote = true;
              return undefined;
            },
          },
        },
      ],
    });

    await expect(ws.append("/sources/large.md", "\nmore")).rejects.toThrow(
      /truncated.*cannot be appended/i,
    );
    expect(wrote).toBe(false);
  });

  it("retries provider reads after writes that return no metadata", async () => {
    let stored = "";
    let readAttemptsAfterWrite = 0;
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
      mounts: [
        {
          path: "/sources",
          access: "readwrite",
          source: {
            kind: "custom",
            list: async () => ({ entries: [] }),
            read: async (path) => {
              if (!stored) return null;
              readAttemptsAfterWrite += 1;
              if (readAttemptsAfterWrite === 1) return null;
              return {
                kind: "text",
                path,
                mimeType: "text/markdown",
                content: stored,
                size: new TextEncoder().encode(stored).byteLength,
              };
            },
            write: async (_path, content) => {
              if (typeof content !== "string") {
                throw new Error("test source only accepts text content");
              }
              stored = content;
              return undefined;
            },
          },
        },
      ],
    });

    await expect(
      ws.write("/sources/brief.md", "eventual", {
        mimeType: "text/markdown",
      }),
    ).resolves.toMatchObject({
      path: "/sources/brief.md",
      storage: "virtual",
      mimeType: "text/markdown",
    });
    expect(readAttemptsAfterWrite).toBe(2);
  });
});
