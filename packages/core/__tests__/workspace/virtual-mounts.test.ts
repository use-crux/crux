import { describe, expect, it } from "vitest";
import { inMemoryRecordStore } from "../../src/storage";
import { workspace } from "../../src/workspace";

describe("workspace virtual mounts", () => {
  it("reads files from a custom mount source", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
      mounts: [
        {
          path: "/sources",
          access: "read",
          source: {
            kind: "custom",
            list: async () => ({ entries: [] }),
            read: async () => ({
              kind: "text",
              path: "/provider/native-brief.md",
              mimeType: "text/markdown",
              content: "# Source",
              size: 8,
            }),
          },
        },
      ],
    });

    await expect(ws.read("/sources/brief.md")).resolves.toMatchObject({
      kind: "text",
      path: "/sources/brief.md",
      mimeType: "text/markdown",
      content: "# Source",
      size: 8,
    });
  });

  it("lists entries from a custom mount source", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
      mounts: [
        {
          path: "/sources",
          access: "read",
          source: {
            kind: "custom",
            list: async (path) => ({
              entries: [
                {
                  kind: "file",
                  path: `${path}/brief.md`,
                  mount: "/provider/native-root",
                  mimeType: "text/markdown",
                  size: 8,
                  storage: "inline",
                  createdAt: 1,
                  updatedAt: 2,
                },
              ],
            }),
            read: async () => null,
          },
        },
      ],
    });

    await expect(ws.list("/sources")).resolves.toMatchObject({
      entries: [
        {
          kind: "file",
          path: "/sources/brief.md",
          mount: "/sources",
          mimeType: "text/markdown",
          storage: "virtual",
          size: 8,
        },
      ],
    });
  });

  it("checks existence and stats files from a custom mount source", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
      mounts: [
        {
          path: "/sources",
          access: "read",
          source: {
            kind: "custom",
            list: async () => ({ entries: [] }),
            read: async () => null,
            exists: async (path) => path === "/sources/brief.md",
            stat: async (path) =>
              path === "/sources/brief.md"
                ? {
                    kind: "file",
                    path,
                    mount: "/provider/native-root",
                    mimeType: "text/markdown",
                    size: 8,
                    storage: "inline",
                    createdAt: 1,
                    updatedAt: 2,
                  }
                : null,
          },
        },
      ],
    });

    await expect(ws.exists("/sources/brief.md")).resolves.toBe(true);
    await expect(ws.exists("/sources/missing.md")).resolves.toBe(false);
    await expect(ws.stat("/sources/brief.md")).resolves.toMatchObject({
      kind: "file",
      path: "/sources/brief.md",
      mount: "/sources",
      mimeType: "text/markdown",
      storage: "virtual",
      size: 8,
    });
    await expect(ws.stat("/sources/missing.md")).resolves.toBeNull();
  });

  it("derives stat metadata from custom source reads when stat is omitted", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
      mounts: [
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
                    content: "alpha",
                    size: 5,
                    metadata: { title: "Brief" },
                  }
                : null,
          },
        },
      ],
    });

    await expect(ws.stat("/sources/brief.md")).resolves.toMatchObject({
      kind: "file",
      path: "/sources/brief.md",
      mount: "/sources",
      mimeType: "text/markdown",
      storage: "virtual",
      size: 5,
      metadata: { title: "Brief" },
    });
    await expect(ws.stat("/sources/missing.md")).resolves.toBeNull();
  });

  it("greps files from a custom mount source", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
      mounts: [
        {
          path: "/sources",
          access: "read",
          source: {
            kind: "custom",
            list: async () => ({
              entries: [
                {
                  kind: "file",
                  path: "/sources/brief.md",
                  mount: "/sources",
                  mimeType: "text/markdown",
                  size: 22,
                  storage: "inline",
                  createdAt: 1,
                  updatedAt: 2,
                },
              ],
            }),
            read: async (path) => ({
              kind: "text",
              path,
              mimeType: "text/markdown",
              content: "alpha needle\nbeta needle",
              size: 22,
            }),
          },
        },
      ],
    });

    const expected = {
      matches: [
        {
          path: "/sources/brief.md",
          line: 1,
          column: 7,
          text: "alpha needle",
        },
      ],
    };
    await expect(
      ws.grep("needle", { path: "/sources", maxResults: 1 }),
    ).resolves.toEqual(expected);
    await expect(
      ws.grep("needle", { path: "/sources/**/*.md", maxResults: 1 }),
    ).resolves.toEqual(expected);
  });

  it("rejects writes to source-backed mounts unless a provider write contract exists", async () => {
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
              content: "draft",
              size: 5,
            }),
          },
        },
      ],
    });

    await expect(ws.write("/sources/new.md", "content")).rejects.toThrow(
      /source-backed mount/i,
    );
    await expect(
      ws.edit("/sources/existing.md", { find: "draft", replace: "final" }),
    ).rejects.toThrow(/source-backed mount/i);
    await expect(ws.delete("/sources/existing.md")).rejects.toThrow(
      /source-backed mount/i,
    );
  });

  it("rejects custom source list entries outside the mount", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
      mounts: [
        {
          path: "/sources",
          access: "read",
          source: {
            kind: "custom",
            list: async () => ({
              entries: [
                {
                  kind: "file",
                  path: "/outside/leak.md",
                  mount: "/outside",
                  mimeType: "text/markdown",
                  size: 4,
                  storage: "virtual",
                  createdAt: 1,
                  updatedAt: 2,
                },
              ],
            }),
            read: async () => null,
          },
        },
      ],
    });

    await expect(ws.list("/sources")).rejects.toThrow(/outside mount/i);
  });
});
