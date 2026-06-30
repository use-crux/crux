import { describe, expect, it } from "vitest";
import { inMemoryRecordStore } from "../../storage";
import { workspace } from "../../workspace";

describe("workspace virtual mount limits", () => {
  it("bounds source-backed list results even when the source ignores limit", async () => {
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
                virtualFile("/sources/a.md"),
                virtualFile("/sources/b.md"),
              ],
            }),
            read: async () => null,
          },
        },
      ],
    });

    await expect(ws.list("/sources", { limit: 1 })).resolves.toMatchObject({
      entries: [{ path: "/sources/a.md" }],
    });
  });
});

function virtualFile(path: string) {
  return {
    kind: "file" as const,
    path,
    mount: "/sources",
    mimeType: "text/markdown",
    size: 1,
    storage: "virtual" as const,
    createdAt: 0,
    updatedAt: 0,
  };
}
