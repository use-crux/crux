import { describe, expect, it } from "vitest";
import { WorkspaceSnapshotError } from "../../src/index";
import { inMemoryRecordStore } from "../../src/storage";
import { workspace } from "../../src/workspace";

describe("workspace snapshots", () => {
  it("preserves typed snapshot error details", () => {
    const cause = new Error("store unavailable");
    const error = new WorkspaceSnapshotError(
      "backend_error",
      "Snapshot creation failed.",
      { snapshotId: "snapshot-1", cause },
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(WorkspaceSnapshotError);
    expect(error).toMatchObject({
      name: "WorkspaceSnapshotError",
      message: "Snapshot creation failed.",
      code: "backend_error",
      snapshotId: "snapshot-1",
      cause,
    });
  });

  it("exposes exactly one frozen snapshot facet", () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });

    expect(Object.keys(ws.snapshot).sort()).toEqual([
      "create",
      "delete",
      "list",
      "restore",
    ]);
    expect(Object.isFrozen(ws.snapshot)).toBe(true);
  });

  it("creates a frozen JSON-safe snapshot for an empty tree", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });

    const snapshot = await ws.snapshot.create({ path: "/outputs/empty/" });

    expect(snapshot).toMatchObject({
      kind: "workspace.snapshot",
      workspaceId: "research",
      namespace: "thread:1",
      path: "/outputs/empty",
      fileCount: 0,
      sizeBytes: 0,
      createdAt: expect.any(Number),
    });
    expect(snapshot.id).not.toBe("");
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it("lists and idempotently deletes a committed snapshot", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });
    const snapshot = await ws.snapshot.create({ path: "/outputs/empty" });

    const page = await ws.snapshot.list();

    expect(page).toEqual({ snapshots: [snapshot] });
    expect(Object.isFrozen(page)).toBe(true);
    expect(Object.isFrozen(page.snapshots)).toBe(true);

    const roundTripped = JSON.parse(
      JSON.stringify(snapshot),
    ) as typeof snapshot;
    await ws.snapshot.delete(roundTripped);
    await expect(ws.snapshot.list()).resolves.toEqual({ snapshots: [] });
    await expect(ws.snapshot.delete(snapshot)).resolves.toBeUndefined();
  });
});
