import { describe, expect, it } from "vitest";
import { inMemoryRecordStore } from "../../storage";
import { workspace } from "../../workspace";

describe("workspace virtual mount versioning", () => {
  it("rejects versioned reads for source-backed files", async () => {
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
              content: "source",
              size: 6,
            }),
          },
        },
      ],
    });

    await expect(
      ws.read("/sources/brief.md", { version: 1 }),
    ).rejects.toThrow(/source-backed mount.*version/i);
  });
});
