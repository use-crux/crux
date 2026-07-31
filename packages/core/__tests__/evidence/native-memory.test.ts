import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "../../src";
import { blackboard } from "../../src/agent/blackboard";
import { workingState } from "../../src/memory";
import { inMemoryRecordStore } from "../../src/storage";

describe("Memory native evidence", () => {
  afterEach(() => {
    resetObservabilityRuntime();
  });

  it("uses a write diff for the exact memory operation and never a read", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const state = workingState({
      id: "state",
      schema: z.object({ phase: z.string() }),
    });
    const records = inMemoryRecordStore();

    await state.set(
      { phase: "build" },
      { records, namespace: "thread:1", memoryId: "planner" },
    );
    await state.get({
      records,
      namespace: "thread:1",
      memoryId: "planner",
    });
    await observe.flush();

    const write = transport.records.find(
      (record) =>
        record.type === "span:start" &&
        record.primitive === "memory.write",
    );
    const read = transport.records.find(
      (record) =>
        record.type === "span:start" &&
        record.primitive === "memory.read",
    );
    expect(write?.type).toBe("span:start");
    if (write?.type !== "span:start") return;
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: "edge",
        edgeType: "evidence.for",
        to: { kind: "span", id: write.spanId },
        attributes: expect.objectContaining({
          role: "change",
          evidenceKind: "memory.diff",
          producer: { kind: "span", id: write.spanId },
        }),
      }),
    );
    expect(
      transport.records.some(
        (record) =>
          record.type === "edge" &&
          record.edgeType === "evidence.for" &&
          record.to.kind === "span" &&
          record.to.id ===
            (read?.type === "span:start" ? read.spanId : ""),
      ),
    ).toBe(false);
  });

  it("binds only explicitly configured blackboard persistence", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const schema = z.object({ status: z.string() });
    const ephemeral = blackboard({ id: "ephemeral", schema });
    const configured = blackboard({
      id: "configured",
      schema,
      records: inMemoryRecordStore(),
    });

    await ephemeral.set("status", "draft");
    await configured.set("status", "ready");
    await observe.flush();

    const evidenceTargets = new Set(
      transport.records.flatMap((record) =>
        record.type === "edge" &&
        record.edgeType === "evidence.for" &&
        record.to.kind === "span"
          ? [record.to.id]
          : [],
      ),
    );
    const spans = transport.records.filter(
      (record) =>
        record.type === "span:start" &&
        record.primitive === "memory.write",
    );
    const ephemeralSpan = spans.find(
      (span) => span.attributes?.memoryId === "ephemeral",
    );
    const configuredSpan = spans.find(
      (span) => span.attributes?.memoryId === "configured",
    );

    expect(
      ephemeralSpan?.type === "span:start" &&
        evidenceTargets.has(ephemeralSpan.spanId),
    ).toBe(false);
    expect(
      configuredSpan?.type === "span:start" &&
        evidenceTargets.has(configuredSpan.spanId),
    ).toBe(true);
  });
});
