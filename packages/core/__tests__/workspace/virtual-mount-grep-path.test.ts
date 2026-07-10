import { describe, expect, it } from "vitest";
import { inMemoryRecordStore } from "../../src/storage";
import { workspace } from "../../src/workspace";

describe("workspace virtual mount grep path", () => {
  it("greps exact source-backed file paths through read fallback", async () => {
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
            read: async (path) => ({
              kind: "text",
              path,
              mimeType: "text/markdown",
              content: "first needle\nsecond needle",
              size: 26,
            }),
          },
        },
      ],
    });

    await expect(
      ws.grep("needle", { path: "/sources/brief.md", maxResults: 1 }),
    ).resolves.toEqual({
      matches: [
        {
          path: "/sources/brief.md",
          line: 1,
          column: 7,
          text: "first needle",
        },
      ],
    });
  });

  it("bounds paged list fallback by maxResults before reading", async () => {
    const listLimits: Array<number | undefined> = [];
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
            list: async (_path, options) => {
              listLimits.push(options?.limit);
              if (options?.cursor === "next") {
                return {
                  entries: [
                    {
                      kind: "file",
                      path: "/sources/match.md",
                      mount: "/sources",
                      mimeType: "text/markdown",
                      size: 11,
                      storage: "virtual",
                      createdAt: 1,
                      updatedAt: 1,
                    },
                  ],
                };
              }
              return {
                entries: [
                  {
                    kind: "file",
                    path: "/sources/no-match.md",
                    mount: "/sources",
                    mimeType: "text/markdown",
                    size: 5,
                    storage: "virtual",
                    createdAt: 1,
                    updatedAt: 1,
                  },
                ],
                cursor: "next",
              };
            },
            read: async (path) => ({
              kind: "text",
              path,
              mimeType: "text/markdown",
              content:
                path === "/sources/match.md" ? "beta needle" : "alpha",
              size: path === "/sources/match.md" ? 11 : 5,
            }),
          },
        },
      ],
    });

    await expect(
      ws.grep("needle", { path: "/sources", maxResults: 1 }),
    ).resolves.toEqual({
      matches: [
        {
          path: "/sources/match.md",
          line: 1,
          column: 6,
          text: "beta needle",
        },
      ],
    });
    expect(listLimits).toEqual([1, 1]);
  });
});
