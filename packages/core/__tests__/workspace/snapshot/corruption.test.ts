import { describe, expect, it } from "vitest";
import type {
  JsonObject,
  RecordEntry,
  RecordStore,
} from "../../../src/storage";
import { inMemoryRecordStore } from "../../../src/storage";
import { workspace, type WorkspaceSnapshotRef } from "../../../src/workspace";

describe("workspace snapshot corruption", () => {
  it("rejects a malformed committed header before live mutation", async () => {
    const records = inMemoryRecordStore();
    const ws = workspace({ id: "research", namespace: "thread:1", records });
    await ws.write("/outputs/report.md", "captured");
    const snapshot = await ws.snapshot.create({ path: "/outputs/report.md" });
    await ws.write("/outputs/report.md", "later");
    const header = await snapshotRecord(
      records,
      (value) =>
        value._cruxWorkspaceSnapshot === true && value.id === snapshot.id,
    );
    await records.put(header.key, { ...header.value, schema: 2 });

    await expect(ws.snapshot.restore(snapshot)).rejects.toMatchObject({
      code: "corrupt_snapshot",
      snapshotId: snapshot.id,
      cause: undefined,
    });
    await expect(ws.read("/outputs/report.md")).resolves.toMatchObject({
      content: "later",
    });
  });

  it("rejects a malformed materialized entry before live mutation", async () => {
    const records = inMemoryRecordStore();
    const ws = workspace({ id: "research", namespace: "thread:1", records });
    await ws.write("/outputs/report.md", "captured");
    const snapshot = await ws.snapshot.create({ path: "/outputs/report.md" });
    await ws.write("/outputs/report.md", "later");
    const entry = await snapshotRecord(
      records,
      (value) =>
        value._cruxWorkspaceSnapshotEntry === true &&
        value.snapshotId === snapshot.id,
    );
    const head = jsonObject(entry.value.head);
    const payload = jsonObject(head.payload);
    await records.put(entry.key, {
      ...entry.value,
      head: { ...head, payload: { ...payload, storage: "invalid" } },
    });

    await expect(ws.snapshot.restore(snapshot)).rejects.toMatchObject({
      code: "corrupt_snapshot",
      snapshotId: snapshot.id,
      cause: undefined,
    });
    await expect(ws.read("/outputs/report.md")).resolves.toMatchObject({
      content: "later",
    });
  });

  it("rejects count, size, and manifest aggregate disagreement", async () => {
    const records = inMemoryRecordStore();
    const ws = workspace({ id: "research", namespace: "thread:1", records });
    await ws.write("/outputs/report.md", "captured");
    const snapshot = await ws.snapshot.create({ path: "/outputs/report.md" });
    await ws.write("/outputs/report.md", "later");
    const header = await snapshotRecord(
      records,
      (value) =>
        value._cruxWorkspaceSnapshot === true && value.id === snapshot.id,
    );
    const cases: readonly {
      readonly value: JsonObject;
      readonly ref: WorkspaceSnapshotRef;
    }[] = [
      {
        value: { ...header.value, fileCount: snapshot.fileCount + 1 },
        ref: { ...snapshot, fileCount: snapshot.fileCount + 1 },
      },
      {
        value: { ...header.value, sizeBytes: snapshot.sizeBytes + 1 },
        ref: { ...snapshot, sizeBytes: snapshot.sizeBytes + 1 },
      },
      {
        value: { ...header.value, manifestFingerprint: "corrupted" },
        ref: snapshot,
      },
    ];

    for (const aggregate of cases) {
      await records.put(header.key, aggregate.value);
      await expect(ws.snapshot.restore(aggregate.ref)).rejects.toMatchObject({
        code: "corrupt_snapshot",
        snapshotId: snapshot.id,
        cause: undefined,
      });
    }
    await expect(ws.read("/outputs/report.md")).resolves.toMatchObject({
      content: "later",
    });
  });
});

async function snapshotRecord(
  store: RecordStore,
  predicate: (value: JsonObject) => boolean,
): Promise<RecordEntry> {
  const page = await store.list("workspace:");
  const record = page.entries.find(({ value }) => predicate(value));
  if (!record) throw new Error("Expected a stored snapshot record.");
  return record;
}

function jsonObject(value: unknown): JsonObject {
  if (!isJsonObject(value)) throw new Error("Expected a JSON object.");
  return value;
}

function isJsonObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
