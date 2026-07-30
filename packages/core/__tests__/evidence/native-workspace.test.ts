import { afterEach, describe, expect, it } from "vitest";
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "../../src";
import { inMemoryRecordStore } from "../../src/storage";
import { workspace } from "../../src/workspace";
import { resetHooks, updateHooks } from "../../src/runtime/runtime";

describe("Workspace native evidence", () => {
  afterEach(() => {
    resetHooks();
    resetObservabilityRuntime();
  });

  it("binds successful mutations to their exact operation spans", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const ws = workspace({
      id: "native-workspace",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });

    await ws.write("/workspace/notes.md", "first");
    await ws.read("/workspace/notes.md");
    await ws.delete("/workspace/notes.md");
    await ws.transaction(async (tx) => {
      await tx.write("/workspace/transaction.md", "committed");
    });
    await observe.flush();

    for (const operation of ["write", "delete", "transaction"]) {
      const span = transport.records.find(
        (record) =>
          record.type === "span:start" &&
          record.name === `workspace.${operation}`,
      );
      expect(span?.type).toBe("span:start");
      if (span?.type !== "span:start") continue;
      expect(transport.records).toContainEqual(
        expect.objectContaining({
          type: "edge",
          edgeType: "evidence.for",
          to: { kind: "span", id: span.spanId },
          attributes: expect.objectContaining({
            role: "change",
            evidenceKind: "output",
            producer: { kind: "span", id: span.spanId },
          }),
        }),
      );
    }

    const readSpan = transport.records.find(
      (record) =>
        record.type === "span:start" &&
        record.name === "workspace.read",
    );
    expect(
      transport.records.some(
        (record) =>
          record.type === "edge" &&
          record.edgeType === "evidence.for" &&
          record.to.kind === "span" &&
          record.to.id ===
            (readSpan?.type === "span:start" ? readSpan.spanId : ""),
      ),
    ).toBe(false);
  });

  it("emits no dependent edge when privacy suppresses a mutation artifact", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    updateHooks({
      observabilityCapture: {
        redactRecord(record) {
          return record.type === "artifact" &&
            record.attributes?.operation === "write"
            ? null
            : record;
        },
      },
    });
    const ws = workspace({
      id: "private-workspace",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });

    await ws.write("/workspace/private.md", "private");
    await observe.flush();

    expect(
      transport.records.some(
        (record) =>
          record.type === "artifact" &&
          record.attributes?.operation === "write",
      ),
    ).toBe(false);
    expect(
      transport.records.some(
        (record) =>
          record.type === "edge" &&
          (record.edgeType === "produced" ||
            record.edgeType === "evidence.for"),
      ),
    ).toBe(false);
  });
});
