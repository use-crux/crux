import { describe, expect, it, vi } from "vitest";
import { inMemoryRecordStore } from "../../../src/storage";
import { workspace } from "../../../src/workspace";
import { pageSizeRecordStore } from "./fixtures";

describe("workspace snapshot selection", () => {
  it("captures complete subtrees and root across backend record pages", async () => {
    const records = pageSizeRecordStore(inMemoryRecordStore(), 1);
    const ws = workspace({ id: "research", namespace: "thread:1", records });
    await ws.write("/outputs/a.txt", "a");
    await ws.write("/outputs/nested/b.txt", "bb");
    await ws.write("/workspace/c.txt", "ccc");

    const subtree = await ws.snapshot.create({ path: "/outputs" });
    const root = await ws.snapshot.create({ path: "/" });

    expect(subtree).toMatchObject({ fileCount: 2, sizeBytes: 3 });
    expect(root).toMatchObject({ fileCount: 3, sizeBytes: 6 });
  });

  it("rejects every source-backed mount overlap before persistence", async () => {
    const records = inMemoryRecordStore();
    const put = vi.spyOn(records, "put");
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records,
      mounts: [
        { path: "/workspace", access: "readwrite" },
        {
          path: "/sources",
          access: "read",
          source: {
            kind: "custom",
            list: () => ({ entries: [] }),
            read: () => null,
          },
        },
      ],
    });

    for (const path of ["/sources", "/sources/nested", "/"]) {
      await expect(ws.snapshot.create({ path })).rejects.toMatchObject({
        code: "unsupported_mount",
      });
    }
    expect(put).not.toHaveBeenCalled();
  });

  it("rejects every source-backed restore overlap before live mutation", async () => {
    const records = inMemoryRecordStore();
    const local = workspace({
      id: "research",
      namespace: "thread:1",
      records,
      mounts: [
        { path: "/workspace", access: "readwrite" },
        { path: "/outputs", access: "readwrite" },
        { path: "/sources", access: "readwrite" },
      ],
    });
    await local.write("/outputs/report.md", "captured");
    const cases = [
      {
        snapshot: await local.snapshot.create({ path: "/outputs" }),
        sourcePath: "/outputs",
      },
      {
        snapshot: await local.snapshot.create({
          path: "/outputs/report.md",
        }),
        sourcePath: "/outputs",
      },
      {
        snapshot: await local.snapshot.create({ path: "/" }),
        sourcePath: "/sources",
      },
    ] as const;
    const put = vi.spyOn(records, "put");
    const remove = vi.spyOn(records, "delete");

    for (const overlap of cases) {
      const sourceBacked = workspace({
        id: "research",
        namespace: "thread:1",
        records,
        mounts: [
          { path: "/workspace", access: "readwrite" },
          {
            path: overlap.sourcePath,
            access: "read",
            source: {
              kind: "custom",
              list: () => ({ entries: [] }),
              read: () => null,
            },
          },
        ],
      });
      await expect(
        sourceBacked.snapshot.restore(overlap.snapshot),
      ).rejects.toMatchObject({
        code: "unsupported_mount",
        snapshotId: overlap.snapshot.id,
      });
    }
    expect(put).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});
