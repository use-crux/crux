import { describe, expect, it } from "vitest";
import { inMemoryRecordStore } from "../../src/storage";
import { workspace } from "../../src/workspace";

describe("workspace virtual mount copy", () => {
  it("copies readable source-backed text files into local writable mounts", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
      mounts: [
        { path: "/workspace", access: "readwrite" },
        {
          path: "/sources",
          access: "read",
          source: {
            kind: "custom",
            list: async () => ({ entries: [] }),
            read: async (path) =>
              path === "/sources/brief.md"
                ? {
                    kind: "text",
                    path,
                    mimeType: "text/markdown",
                    content: "source brief",
                    size: 12,
                    metadata: { title: "Brief" },
                  }
                : null,
          },
        },
      ],
    });

    await expect(
      ws.copy("/sources/brief.md", "/workspace/brief.md"),
    ).resolves.toMatchObject({
      path: "/workspace/brief.md",
      mimeType: "text/markdown",
      metadata: { title: "Brief" },
      storage: "inline",
    });
    await expect(ws.read("/workspace/brief.md")).resolves.toMatchObject({
      kind: "text",
      path: "/workspace/brief.md",
      content: "source brief",
      metadata: { title: "Brief" },
    });
  });

  it("copies source-backed string JSON into local JSON storage", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
      mounts: [
        { path: "/workspace", access: "readwrite" },
        {
          path: "/sources",
          access: "read",
          source: {
            kind: "custom",
            list: async () => ({ entries: [] }),
            read: async (path) =>
              path === "/sources/value.json"
                ? {
                    kind: "json",
                    path,
                    mimeType: "application/json",
                    content: "ready",
                    size: JSON.stringify("ready").length,
                  }
                : null,
          },
        },
      ],
    });

    await ws.copy("/sources/value.json", "/workspace/value.json");

    await expect(ws.read("/workspace/value.json")).resolves.toEqual({
      kind: "json",
      path: "/workspace/value.json",
      mimeType: "application/json",
      content: "ready",
      size: JSON.stringify("ready").length,
    });
  });

  it("does not fall back to local records when source-backed reads are missing", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
      mounts: [
        { path: "/workspace", access: "readwrite" },
        {
          path: "/sources",
          access: "read",
          source: {
            kind: "custom",
            list: async () => ({ entries: [] }),
            read: async () => null,
          },
        },
      ],
    });

    await expect(
      ws.copy("/sources/missing.md", "/workspace/missing.md"),
    ).rejects.toThrow(/source file not found/i);
  });

  it("rejects truncated source-backed text before copying", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
      mounts: [
        { path: "/workspace", access: "readwrite" },
        {
          path: "/sources",
          access: "read",
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
          },
        },
      ],
    });

    await expect(
      ws.copy("/sources/large.md", "/workspace/large.md"),
    ).rejects.toThrow(/truncated.*cannot be copied/i);
  });
});
