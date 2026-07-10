import { describe, expect, it } from "vitest";
import { inMemoryRecordStore } from "../../src/storage";
import { workspace } from "../../src/workspace";

describe("workspace virtual mount grep", () => {
  it("includes source-backed mounts in unscoped grep results", async () => {
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
            list: async () => ({
              entries: [
                {
                  kind: "file",
                  path: "/sources/brief.md",
                  mount: "/sources",
                  mimeType: "text/markdown",
                  size: 13,
                  storage: "virtual",
                  createdAt: 0,
                  updatedAt: 0,
                },
              ],
            }),
            read: async (path) => ({
              kind: "text",
              path,
              mimeType: "text/markdown",
              content: "source needle",
              size: 13,
            }),
          },
        },
      ],
    });

    await ws.write("/workspace/local.md", "local needle");

    await expect(ws.grep("needle")).resolves.toEqual({
      matches: [
        {
          path: "/workspace/local.md",
          line: 1,
          column: 7,
          text: "local needle",
        },
        {
          path: "/sources/brief.md",
          line: 1,
          column: 8,
          text: "source needle",
        },
      ],
    });
  });
});
