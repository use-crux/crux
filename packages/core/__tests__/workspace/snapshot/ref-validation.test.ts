import { describe, expect, it, vi } from "vitest";
import { inMemoryRecordStore } from "../../../src/storage";
import { workspace, type WorkspaceSnapshotRef } from "../../../src/workspace";

describe("workspace snapshot reference validation", () => {
  it("rejects every malformed required field before storage lookup", async () => {
    const records = inMemoryRecordStore();
    const get = vi.spyOn(records, "get");
    const list = vi.spyOn(records, "list");
    const ws = workspace({ id: "research", namespace: "thread:1", records });
    const valid = snapshotRef();
    const malformed: readonly unknown[] = [
      null,
      { ...valid, kind: "snapshot" },
      { ...valid, id: "" },
      { ...valid, workspaceId: "" },
      { ...valid, namespace: " " },
      { ...valid, path: "outputs" },
      { ...valid, fileCount: -1 },
      { ...valid, sizeBytes: 1.5 },
      { ...valid, createdAt: Number.NaN },
    ];

    for (const candidate of malformed) {
      await expect(
        ws.snapshot.restore(candidate as WorkspaceSnapshotRef),
      ).rejects.toMatchObject({ code: "invalid_reference" });
      await expect(
        ws.snapshot.delete(candidate as WorkspaceSnapshotRef),
      ).rejects.toMatchObject({ code: "invalid_reference" });
    }
    expect(get).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });

  it("rejects a foreign Workspace reference before storage lookup", async () => {
    const records = inMemoryRecordStore();
    const get = vi.spyOn(records, "get");
    const list = vi.spyOn(records, "list");
    const ws = workspace({ id: "research", namespace: "thread:1", records });
    const foreign = snapshotRef({ workspaceId: "other" });

    await expect(ws.snapshot.restore(foreign)).rejects.toMatchObject({
      code: "invalid_reference",
      snapshotId: foreign.id,
    });
    await expect(ws.snapshot.delete(foreign)).rejects.toMatchObject({
      code: "invalid_reference",
      snapshotId: foreign.id,
    });
    expect(get).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });

  it("reports an absent restore as not found while delete stays idempotent", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });
    const absent = snapshotRef();

    await expect(ws.snapshot.restore(absent)).rejects.toMatchObject({
      name: "WorkspaceSnapshotError",
      code: "not_found",
      snapshotId: absent.id,
      cause: undefined,
    });
    await expect(ws.snapshot.delete(absent)).resolves.toBeUndefined();
    await expect(ws.snapshot.delete(absent)).resolves.toBeUndefined();
  });
});

function snapshotRef(
  overrides: Partial<WorkspaceSnapshotRef> = {},
): WorkspaceSnapshotRef {
  return {
    kind: "workspace.snapshot",
    id: "snapshot-id",
    workspaceId: "research",
    namespace: "thread:1",
    path: "/outputs",
    fileCount: 0,
    sizeBytes: 0,
    createdAt: 1,
    ...overrides,
  };
}
