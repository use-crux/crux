import { describe, expect, it } from "vitest";
import { retriever } from "../../retrieval";
import { inMemoryRecordStore } from "../../storage";
import { retrieverWorkspaceMountSource, workspace } from "../../workspace";

describe("workspace retriever mounts", () => {
  it("lists and reads retriever hits as virtual files", async () => {
    const sources = retriever({
      id: "knowledge",
      namespace: "thread:1",
      retrieve: async () => [
        {
          namespace: "thread:1",
          sourceId: "brief",
          chunkId: "intro",
          content: "alpha needle",
          metadata: { title: "Brief" },
          score: 0.9,
          sourcePath: "brief.md",
        },
      ],
    });
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
      mounts: [
        {
          path: "/sources",
          access: "read",
          source: retrieverWorkspaceMountSource(sources, { query: "brief" }),
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
          size: 12,
        },
      ],
    });
    await expect(ws.list("/sources/**/*.md")).resolves.toMatchObject({
      entries: [{ path: "/sources/brief.md" }],
    });
    await expect(ws.read("/sources/brief.md")).resolves.toMatchObject({
      kind: "text",
      path: "/sources/brief.md",
      mimeType: "text/markdown",
      content: "alpha needle",
      size: 12,
      metadata: { title: "Brief" },
    });
  });

  it("accepts the direct retriever mount source shape", async () => {
    const sources = retriever({
      id: "knowledge",
      namespace: "thread:1",
      retrieve: async () => [
        {
          namespace: "thread:1",
          sourceId: "brief",
          chunkId: "intro",
          content: "direct source",
          metadata: {},
          score: 0.9,
          sourcePath: "brief.md",
        },
      ],
    });
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
      mounts: [
        {
          path: "/sources",
          access: "read",
          source: { kind: "retriever", retriever: sources, query: "brief" },
        },
      ],
    });

    await expect(ws.read("/sources/brief.md")).resolves.toMatchObject({
      kind: "text",
      path: "/sources/brief.md",
      content: "direct source",
    });
  });

  it("greps retriever mounts with the grep query and stats projected files", async () => {
    const queries: string[] = [];
    const sources = retriever({
      id: "knowledge",
      namespace: "thread:1",
      retrieve: async (query) => {
        queries.push(query);
        return [
          {
            namespace: "thread:1",
            sourceId: "brief",
            chunkId: "intro",
            content: "alpha needle\nbeta",
            metadata: {},
            score: 0.9,
            sourcePath: "brief.md",
          },
        ];
      },
    });
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
      mounts: [
        {
          path: "/sources",
          access: "read",
          source: retrieverWorkspaceMountSource(sources, { query: "brief" }),
        },
      ],
    });

    await expect(ws.exists("/sources/brief.md")).resolves.toBe(true);
    await expect(ws.stat("/sources/brief.md")).resolves.toMatchObject({
      kind: "file",
      path: "/sources/brief.md",
      storage: "virtual",
      size: 17,
    });
    await expect(
      ws.grep("needle", { path: "/sources/**/*.md" }),
    ).resolves.toEqual({
      matches: [
        {
          path: "/sources/brief.md",
          line: 1,
          column: 7,
          text: "alpha needle",
        },
      ],
    });
    expect(queries).toContain("needle");
  });

  it("rejects retriever hits mapped outside the mount", async () => {
    const sources = retriever({
      id: "knowledge",
      namespace: "thread:1",
      retrieve: async () => [
        {
          namespace: "thread:1",
          sourceId: "brief",
          chunkId: "intro",
          content: "leak",
          metadata: {},
          score: 0.9,
          sourcePath: "brief.md",
        },
      ],
    });
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
      mounts: [
        {
          path: "/sources",
          access: "read",
          source: retrieverWorkspaceMountSource(sources, {
            query: "brief",
            pathForHit: () => "/outside/brief.md",
          }),
        },
      ],
    });

    await expect(ws.list("/sources")).rejects.toThrow(/outside mount/i);
  });

  it("applies list limits after scope filtering", async () => {
    const retrieveLimits: Array<number | undefined> = [];
    const sources = retriever({
      id: "knowledge",
      namespace: "thread:1",
      retrieve: async (_query, options) => {
        retrieveLimits.push(options?.limit);
        return [
          {
            namespace: "thread:1",
            sourceId: "outside",
            chunkId: "intro",
            content: "outside",
            metadata: {},
            score: 0.9,
            sourcePath: "outside/a.md",
          },
          {
            namespace: "thread:1",
            sourceId: "allowed",
            chunkId: "intro",
            content: "allowed",
            metadata: {},
            score: 0.8,
            sourcePath: "allowed/b.md",
          },
        ];
      },
    });
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
      mounts: [
        {
          path: "/sources",
          access: "read",
          source: retrieverWorkspaceMountSource(sources, { query: "brief" }),
        },
      ],
    });

    await expect(ws.list("/sources/allowed", { limit: 1 })).resolves.toEqual({
      entries: [
        expect.objectContaining({
          kind: "file",
          path: "/sources/allowed/b.md",
        }),
      ],
    });
    expect(retrieveLimits).toEqual([undefined]);
  });

  it("applies grep result limits after text filtering", async () => {
    const retrieveLimits: Array<number | undefined> = [];
    const sources = retriever({
      id: "knowledge",
      namespace: "thread:1",
      retrieve: async (_query, options) => {
        retrieveLimits.push(options?.limit);
        return [
          {
            namespace: "thread:1",
            sourceId: "no-match",
            chunkId: "intro",
            content: "alpha",
            metadata: {},
            score: 0.9,
            sourcePath: "a.md",
          },
          {
            namespace: "thread:1",
            sourceId: "match",
            chunkId: "intro",
            content: "beta needle",
            metadata: {},
            score: 0.8,
            sourcePath: "b.md",
          },
        ];
      },
    });
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
      mounts: [
        {
          path: "/sources",
          access: "read",
          source: retrieverWorkspaceMountSource(sources),
        },
      ],
    });

    await expect(
      ws.grep("needle", { path: "/sources/**/*.md", maxResults: 1 }),
    ).resolves.toEqual({
      matches: [
        {
          path: "/sources/b.md",
          line: 1,
          column: 6,
          text: "beta needle",
        },
      ],
    });
    expect(retrieveLimits).toEqual([undefined]);
  });
});
