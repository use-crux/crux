import { describe, expect, it } from "vitest";
import { inMemoryRecordStore } from "../../storage";
import { workspace } from "../../workspace";

describe("workspace virtual mount mutations", () => {
  it("rejects artifact and version mutations on source-backed mounts", async () => {
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
              content: "source",
              size: 6,
            }),
          },
        },
      ],
    });

    await expect(ws.finalize("/sources/brief.md")).rejects.toThrow(
      /source-backed mount/i,
    );
    await expect(ws.undo("/sources/brief.md")).rejects.toThrow(
      /source-backed mount/i,
    );
  });
});
