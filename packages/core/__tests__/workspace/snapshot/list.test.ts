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

  it("binds cursors across Workspace and namespace scopes", async () => {
    const records = inMemoryRecordStore();
    const ws = workspace({ id: "research", namespace: "thread:a", records });
    await ws.snapshot.create({ path: "/outputs" });
    await ws.snapshot.create({ path: "/outputs" });
    const first = await ws.snapshot.list({ limit: 1 });
    const cursor = first.cursor!;

    await expect(
      ws.snapshot.list({ namespace: "thread:b", cursor }),
    ).rejects.toMatchObject({ code: "invalid_cursor" });
    const foreign = workspace({
      id: "other",
      namespace: "thread:a",
      records,
    });
    await expect(foreign.snapshot.list({ cursor })).rejects.toMatchObject({
      code: "invalid_cursor",
    });
  });

  it("defaults to fifty and accepts both limit boundaries", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });
    for (let index = 0; index < 101; index += 1) {
      await ws.snapshot.create({ path: "/outputs" });
    }

    await expect(ws.snapshot.list({ limit: 1 })).resolves.toMatchObject({
      snapshots: [expect.any(Object)],
      cursor: expect.any(String),
    });
    const defaultPage = await ws.snapshot.list();
    expect(defaultPage.snapshots).toHaveLength(50);
    expect(defaultPage.cursor).toEqual(expect.any(String));
    const maximum = await ws.snapshot.list({ limit: 100 });
    expect(maximum.snapshots).toHaveLength(100);
    expect(maximum.cursor).toEqual(expect.any(String));
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

  it("reports a malformed committed header in the requested scope", async () => {
    const records = inMemoryRecordStore();
    const ws = workspace({ id: "research", namespace: "thread:1", records });
    const snapshot = await ws.snapshot.create({ path: "/outputs" });
    const page = await records.list("workspace:");
    const header = page.entries.find(
      ({ value }) =>
        value._cruxWorkspaceSnapshot === true && value.id === snapshot.id,
    );
    if (!header) throw new Error("Expected a stored snapshot header.");
    await records.put(header.key, { ...header.value, fileCount: "invalid" });

    await expect(ws.snapshot.list()).rejects.toMatchObject({
      name: "WorkspaceSnapshotError",
      code: "corrupt_snapshot",
      snapshotId: snapshot.id,
    });
  });

  it("skips a malformed committed header outside an exact path filter", async () => {
    const records = inMemoryRecordStore();
    const ws = workspace({ id: "research", namespace: "thread:1", records });
    const snapshot = await ws.snapshot.create({ path: "/workspace" });
    const page = await records.list("workspace:");
    const header = page.entries.find(
      ({ value }) =>
        value._cruxWorkspaceSnapshot === true && value.id === snapshot.id,
    );
    if (!header) throw new Error("Expected a stored snapshot header.");
    await records.put(header.key, { ...header.value, fileCount: "invalid" });

    await expect(ws.snapshot.list({ path: "/outputs" })).resolves.toEqual({
      snapshots: [],
    });
  });

  it("does not fail a page for malformed committed headers beyond its limit", async () => {
    const records = inMemoryRecordStore();
    const ws = workspace({ id: "research", namespace: "thread:1", records });
    await ws.snapshot.create({ path: "/outputs" });
    await ws.snapshot.create({ path: "/outputs" });
    const first = await ws.snapshot.list({ limit: 1 });
    const all = await ws.snapshot.list();
    const beyondPage = all.snapshots.find(
      (snapshot) => snapshot.id !== first.snapshots[0]?.id,
    );
    if (!beyondPage) throw new Error("Expected a snapshot beyond page one.");
    await corruptSnapshotHeader(records, beyondPage.id);

    await expect(ws.snapshot.list({ limit: 1 })).resolves.toEqual(first);
  });

  it("ignores a malformed committed header ahead of the requested cursor", async () => {
    const records = inMemoryRecordStore();
    const ws = workspace({ id: "research", namespace: "thread:1", records });
    await ws.snapshot.create({ path: "/outputs" });
    await ws.snapshot.create({ path: "/outputs" });
    const first = await ws.snapshot.list({ limit: 1 });
    const firstSnapshot = first.snapshots[0];
    if (!firstSnapshot || !first.cursor) {
      throw new Error("Expected a first snapshot and continuation cursor.");
    }
    await corruptSnapshotHeader(records, firstSnapshot.id);

    await expect(
      ws.snapshot.list({ limit: 1, cursor: first.cursor }),
    ).resolves.toMatchObject({ snapshots: [expect.any(Object)] });
  });
});

async function corruptSnapshotHeader(
  records: ReturnType<typeof inMemoryRecordStore>,
  snapshotId: string,
): Promise<void> {
  const page = await records.list("workspace:");
  const header = page.entries.find(
    ({ value }) =>
      value._cruxWorkspaceSnapshot === true && value.id === snapshotId,
  );
  if (!header) throw new Error(`Expected snapshot header ${snapshotId}.`);
  await records.put(header.key, { ...header.value, fileCount: "invalid" });
}
