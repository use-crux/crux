import { describe, expect, it } from "vitest";
import { workspace } from "../../../src/workspace";
import type { JsonObject } from "../../../src/storage";
import { controlledRecordStore, storedValues } from "./fixtures";

describe("workspace snapshot consistency", () => {
  it("captures wholly after a two-path transaction target commit", async () => {
    const records = controlledRecordStore();
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: records.store,
    });
    await ws.write("/outputs/a.md", "old-a");
    await ws.write("/outputs/b.md", "old-b");
    const firstTargetPut = records.blockPutWhen(
      (value) =>
        value._cruxWorkspaceFile === true &&
        value.namespace === "thread:1" &&
        value.path === "/outputs/a.md" &&
        value.inlineText === "new-a",
    );

    const transaction = ws.transaction(async (tx) => {
      await tx.write("/outputs/b.md", "new-b");
      await tx.write("/outputs/a.md", "new-a");
    });
    await firstTargetPut.entered;

    const capture = ws.snapshot.create({ path: "/outputs" });
    await Promise.resolve();
    await Promise.resolve();
    firstTargetPut.release();

    const [, snapshot] = await Promise.all([transaction, capture]);
    expect(await capturedInlineText(records.store, snapshot.id)).toEqual({
      "/outputs/a.md": "new-a",
      "/outputs/b.md": "new-b",
    });
  });
});

async function capturedInlineText(
  store: Parameters<typeof storedValues>[0],
  snapshotId: string,
): Promise<Record<string, string>> {
  const entries = await storedValues(
    store,
    (value) =>
      value._cruxWorkspaceSnapshotEntry === true &&
      value.snapshotId === snapshotId,
  );
  return Object.fromEntries(entries.map(snapshotTextEntry));
}

function snapshotTextEntry(value: JsonObject): readonly [string, string] {
  if (
    typeof value.path !== "string" ||
    !isJsonObject(value.head) ||
    !isJsonObject(value.head.payload) ||
    typeof value.head.payload.content !== "string"
  ) {
    throw new Error("Expected an inline-text snapshot entry.");
  }
  return [value.path, value.head.payload.content] as const;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
