import { describe, expect, it, vi } from "vitest";
import { inMemoryRecordStore } from "../../../src/storage";
import { workspace } from "../../../src/workspace";
import { withListedRecords } from "./fixtures";

describe("workspace snapshot listing", () => {
  it("orders equal-time snapshots by opaque id descending", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const first = await ws.snapshot.create({ path: "/outputs" });
    const second = await ws.snapshot.create({ path: "/outputs" });
    now.mockRestore();

    const page = await ws.snapshot.list();

    expect(page.snapshots.map((snapshot) => snapshot.id)).toEqual(
      [first.id, second.id].sort((left, right) => right.localeCompare(left)),
    );
  });

  it("filters exact normalized paths and traverses logical cursor pages", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });
    const expected = [];
    expected.push(await ws.snapshot.create({ path: "/outputs/" }));
    await ws.snapshot.create({ path: "/workspace" });
    expected.push(await ws.snapshot.create({ path: "/outputs" }));
    expected.push(await ws.snapshot.create({ path: "/outputs" }));

    const first = await ws.snapshot.list({ path: "/outputs/", limit: 2 });
    const second = await ws.snapshot.list({
      path: "/outputs",
      limit: 2,
      cursor: first.cursor!,
    });

    expect(first.snapshots).toHaveLength(2);
    expect(first.cursor).toEqual(expect.any(String));
    expect(second.cursor).toBeUndefined();
    expect([...first.snapshots, ...second.snapshots]).toEqual(
      expected.sort(
        (left, right) =>
          right.createdAt - left.createdAt || right.id.localeCompare(left.id),
      ),
    );
  });

  it("validates limits before storage and binds cursors to their scope", async () => {
    const records = inMemoryRecordStore();
    const list = vi.spyOn(records, "list");
    const ws = workspace({ id: "research", namespace: "thread:1", records });

    for (const limit of [0, 1.5, 101]) {
      await expect(ws.snapshot.list({ limit })).rejects.toBeInstanceOf(
        RangeError,
      );
    }
    expect(list).not.toHaveBeenCalled();

    await ws.snapshot.create({ path: "/outputs" });
    await ws.snapshot.create({ path: "/outputs" });
    const first = await ws.snapshot.list({ path: "/outputs", limit: 1 });
    await expect(
      ws.snapshot.list({ path: "/workspace", cursor: first.cursor! }),
    ).rejects.toMatchObject({ code: "invalid_cursor" });
    await expect(
      ws.snapshot.list({ cursor: "not-a-cursor" }),
    ).rejects.toMatchObject({ code: "invalid_cursor" });
  });

  it("does not project headers whose key or body escapes the listing scope", async () => {
    const header = {
      _cruxWorkspaceSnapshot: true,
      schema: 1,
      state: "committed",
      id: "foreign-id",
      workspaceId: "research",
      namespace: "thread:1",
      path: "/outputs",
      fileCount: 0,
      sizeBytes: 0,
      createdAt: 1,
      manifestFingerprint: "fingerprint",
    } as const;
    const records = withListedRecords(inMemoryRecordStore(), [
      { key: "unrelated-key", value: header },
      {
        key: "another-unrelated-key",
        value: { ...header, id: "wrong-namespace", namespace: "thread:2" },
      },
    ]);
    const ws = workspace({ id: "research", namespace: "thread:1", records });

    await expect(ws.snapshot.list()).resolves.toEqual({ snapshots: [] });
  });
});
