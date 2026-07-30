import { afterEach, describe, expect, it } from "vitest";
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "../../src";
import { instrumentToolSet } from "../../src/adapter/tool/emission";
import { emitToolApprovalObservation } from "../../src/adapter/tool/approval";
import { resetHooks, updateHooks } from "../../src/runtime/runtime";

describe("tool intent evidence", () => {
  afterEach(() => {
    resetHooks();
    resetObservabilityRuntime();
  });

  it("binds the safe args artifact to its exact tool-call span", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const tools = instrumentToolSet({
      search: {
        execute: async (input: unknown) => input,
      },
    });

    await tools?.search.execute(
      { query: "refund" },
      { toolCallId: "call_search" },
    );
    await observe.flush();

    const span = transport.records.find(
      (record) =>
        record.type === "span:start" && record.primitive === "tool.call",
    );
    const artifact = transport.records.find(
      (record) => record.type === "artifact" && record.kind === "tool.args",
    );
    expect(span?.type).toBe("span:start");
    expect(artifact?.type).toBe("artifact");
    if (span?.type !== "span:start" || artifact?.type !== "artifact") return;

    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: "edge",
        edgeType: "evidence.for",
        from: { kind: "artifact", id: artifact.artifactId },
        to: { kind: "span", id: span.spanId },
        attributes: expect.objectContaining({
          role: "intent",
          evidenceKind: "tool.args",
          producer: { kind: "span", id: span.spanId },
        }),
      }),
    );
  });

  it("does not infer intent for an approval lifecycle span", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);

    emitToolApprovalObservation("request", {
      approvalId: "approval_call_search",
      toolCallId: "call_search",
      toolName: "search",
      input: { query: "refund" },
    });
    await observe.flush();

    const approval = transport.records.find(
      (record) =>
        record.type === "span:start" && record.primitive === "tool.approval",
    );
    expect(approval?.type).toBe("span:start");
    if (approval?.type !== "span:start") return;
    expect(
      transport.records.some(
        (record) =>
          record.type === "edge" &&
          record.edgeType === "evidence.for" &&
          record.to.kind === "span" &&
          record.to.id === approval.spanId,
      ),
    ).toBe(false);
  });

  it("omits the dependent intent graph when privacy drops the args", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    updateHooks({
      observabilityCapture: {
        redactRecord(record) {
          return record.type === "artifact" && record.kind === "tool.args"
            ? null
            : record;
        },
      },
    });
    const tools = instrumentToolSet({
      search: { execute: async () => "ok" },
    });

    await tools?.search.execute(
      { query: "private" },
      { toolCallId: "call_search" },
    );
    await observe.flush();

    expect(
      transport.records.some(
        (record) =>
          (record.type === "artifact" && record.kind === "tool.args") ||
          (record.type === "edge" &&
            (record.edgeType === "consumed" ||
              record.edgeType === "evidence.for")),
      ),
    ).toBe(false);
  });
});
