import { afterEach, describe, expect, it } from "vitest";
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "../../../src/observability";
import { inMemoryAssetStore, inMemoryRecordStore } from "../../../src/storage";
import { workspace } from "../../../src/workspace";
import { controlledRecordStore, snapshotAssetUri } from "./fixtures";

afterEach(() => {
  resetObservabilityRuntime();
});

describe("workspace snapshot observability", () => {
  it("instruments all four operations through workspace.operation", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });
    await ws.write("/outputs/report.md", "captured");
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);

    const snapshot = await ws.snapshot.create({ path: "/outputs" });
    await ws.snapshot.list({ path: "/outputs" });
    await ws.snapshot.restore(snapshot);
    await ws.snapshot.delete(snapshot);
    await observe.flush();

    const spans = transport.records.filter(
      (record) =>
        record.type === "span:start" &&
        record.name.startsWith("workspace.snapshot."),
    );
    expect(spans.map((span) => span.attributes?.operation)).toEqual([
      "snapshot.create",
      "snapshot.list",
      "snapshot.restore",
      "snapshot.delete",
    ]);
    expect(
      spans.every((span) => span.primitive === "workspace.operation"),
    ).toBe(true);
  });

  it("records only aggregate snapshot result attributes", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });
    await ws.write("/outputs/report.md", "captured");
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);

    const snapshot = await ws.snapshot.create({ path: "/outputs" });
    await ws.snapshot.list({ path: "/outputs" });
    await ws.snapshot.restore(snapshot);
    await observe.flush();

    expect(
      endAttributes(transport.records, "workspace.snapshot.create"),
    ).toEqual(
      expect.objectContaining({
        resultKind: "workspace.snapshot",
        fileCount: 1,
        sizeBytes: 8,
      }),
    );
    expect(endAttributes(transport.records, "workspace.snapshot.list")).toEqual(
      expect.objectContaining({
        resultKind: "snapshot.list",
        snapshotCount: 1,
      }),
    );
    expect(
      endAttributes(transport.records, "workspace.snapshot.restore"),
    ).toEqual(
      expect.objectContaining({
        resultKind: "snapshot.restore",
        restoredFiles: 0,
        deletedFiles: 0,
        unchangedFiles: 1,
      }),
    );
  });

  it("labels restored version markers with the restore operation", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });
    await ws.write("/outputs/report.md", "captured");
    const snapshot = await ws.snapshot.create({ path: "/outputs/report.md" });
    await ws.write("/outputs/report.md", "later");
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);

    await ws.snapshot.restore(snapshot);
    await observe.flush();

    const markers = transport.records.filter(
      (record) =>
        record.type === "span:start" && record.name === "workspace.version",
    );
    expect(markers.map((marker) => marker.attributes?.operation)).toEqual([
      "restore",
    ]);
    expect(markers[0]?.attributes?.pathHash).toMatch(/^fnv1a:/);
  });

  it("never emits raw snapshot paths, content, refs, manifests, or asset URIs", async () => {
    const records = inMemoryRecordStore();
    const assets = inMemoryAssetStore();
    const ws = workspace({
      id: "research",
      namespace: "thread:private",
      records,
      assets,
      content: { inlineTextBelowBytes: 0 },
    });
    const path = "/outputs/private-report.md";
    const content = "snapshot-content-secret";
    await ws.write(path, content);
    const live = await ws.stat(path);
    if (live?.kind !== "file" || !live.uri) {
      throw new Error("Expected an asset-backed live file.");
    }
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);

    const snapshot = await ws.snapshot.create({ path });
    const snapshotUri = await snapshotAssetUri(records, snapshot.id);
    const page = await records.list("workspace:");
    const header = page.entries.find(
      ({ value }) =>
        value._cruxWorkspaceSnapshot === true && value.id === snapshot.id,
    );
    const manifest = header?.value.manifestFingerprint;
    if (typeof manifest !== "string") {
      throw new Error("Expected a snapshot manifest fingerprint.");
    }
    await ws.snapshot.list({ path });
    await ws.snapshot.restore(snapshot);
    await ws.snapshot.delete(snapshot);
    await observe.flush();

    const serialized = JSON.stringify(transport.records);
    for (const secret of [
      path,
      content,
      snapshot.id,
      manifest,
      live.uri,
      snapshotUri,
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).toContain("pathHash");
  });

  it("records typed failures without leaking the snapshot reference", async () => {
    const records = inMemoryRecordStore();
    const ws = workspace({ id: "research", namespace: "thread:1", records });
    const path = "/outputs/private-report.md";
    await ws.write(path, "private-content");
    const snapshot = await ws.snapshot.create({ path });
    const page = await records.list("workspace:");
    const header = page.entries.find(
      ({ value }) =>
        value._cruxWorkspaceSnapshot === true && value.id === snapshot.id,
    );
    if (!header) throw new Error("Expected a stored snapshot header.");
    await records.put(header.key, { ...header.value, schema: 2 });
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);

    await expect(ws.snapshot.restore(snapshot)).rejects.toMatchObject({
      code: "corrupt_snapshot",
    });
    await observe.flush();

    const start = transport.records.find(
      (record) =>
        record.type === "span:start" &&
        record.name === "workspace.snapshot.restore",
    );
    if (!start) throw new Error("Missing restore span.");
    const end = transport.records.find(
      (record) => record.type === "span:end" && record.spanId === start.spanId,
    );
    expect(end).toMatchObject({
      status: "error",
      error: {
        name: "WorkspaceSnapshotError",
        category: "corrupt_snapshot",
      },
    });
    const serialized = JSON.stringify(transport.records);
    expect(serialized).not.toContain(path);
    expect(serialized).not.toContain("private-content");
    expect(serialized).not.toContain(snapshot.id);
  });

  it("redacts generic snapshot failures before recording them", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:private",
      records: inMemoryRecordStore(),
    });
    const privatePath = "private/../snapshot-secret.md";
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);

    await expect(ws.snapshot.create({ path: privatePath })).rejects.toThrow();
    await observe.flush();

    const serialized = JSON.stringify(transport.records);
    expect(serialized).not.toContain(privatePath);
    expect(serialized).toContain("Workspace snapshot operation failed.");
  });

  it("emits no version markers when a multi-path restore rolls back", async () => {
    const records = controlledRecordStore();
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: records.store,
    });
    await ws.write("/outputs/a.md", "captured-a");
    await ws.write("/outputs/b.md", "captured-b");
    const snapshot = await ws.snapshot.create({ path: "/outputs" });
    await ws.write("/outputs/a.md", "later-a");
    await ws.write("/outputs/b.md", "later-b");
    records.failPutWhen(
      (value) =>
        value._cruxWorkspaceFile === true &&
        value.path === "/outputs/b.md" &&
        value.inlineText === "captured-b",
      new Error("path two failed"),
    );
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);

    await expect(ws.snapshot.restore(snapshot)).rejects.toMatchObject({
      code: "backend_error",
    });
    await observe.flush();

    expect(
      transport.records.filter(
        (record) =>
          record.type === "span:start" && record.name === "workspace.version",
      ),
    ).toEqual([]);
  });
});

function endAttributes(
  records: ReturnType<typeof createInMemoryObservabilityTransport>["records"],
  name: string,
) {
  const start = records.find(
    (candidate) => candidate.type === "span:start" && candidate.name === name,
  );
  if (!start) throw new Error(`Missing span:start for ${name}.`);
  const record = records.find(
    (candidate) =>
      candidate.type === "span:end" && candidate.spanId === start.spanId,
  );
  if (!record) throw new Error(`Missing span:end for ${name}.`);
  return record.attributes;
}
