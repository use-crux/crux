import { describe, expect, it } from "vitest";
import { semanticKindFor } from "@/features/run-detail/components/SpanTree";
import type { ObservabilityRunDetailNode } from "@/types";
import type { SpanNode } from "@/features/observability/lib/span-tree";
import { classifyPrimitive } from "./span-detail-inspection";
import { memoryCaptureFromNode } from "./memory-capture";

function captureNode(
  attributes: Record<string, unknown>,
): ObservabilityRunDetailNode {
  return {
    id: "node:capture",
    spanId: "span:capture",
    runId: "run:generation",
    traceId: "trace:generation",
    parentSpanId: "span:generation",
    family: "memory",
    primitive: "memory.capture",
    name: "memory.capture",
    status: "ok",
    startedAt: "2026-07-21T10:00:00.000Z",
    endedAt: "2026-07-21T10:00:00.030Z",
    durationMs: 30,
    model: "",
    provider: "",
    attributes,
    definitionRefs: [
      {
        id: "memory:conversation",
        kind: "memory",
        role: "invoked-memory",
      },
    ],
    virtual: false,
    parentId: "node:generation",
    path: ["node:generation", "node:capture"],
    kind: "memory",
    display: { kind: "memory", label: "memory.capture" },
    timing: { durationMs: 30, selfMs: 20, childrenMs: 10, detailsMs: 0 },
    metricBuckets: {},
    source: { placementReason: "child" },
    details: [],
    artifacts: [],
    events: [],
    relations: [],
    diagnostics: [],
    children: [],
  } as unknown as ObservabilityRunDetailNode;
}

const baseAttributes = {
  memoryId: "conversation",
  operation: "turn",
  requestedMode: "deferred",
  sequence: 7,
  blockCount: 2,
  toolEventCount: 1,
} as const;

describe("memory capture Run Detail projection", () => {
  it("selects the dedicated panel while remaining in the memory tree family", () => {
    const treeNode: SpanNode = {
      id: "node:capture",
      kind: "trace",
      primitive: "memory.capture",
      label: "Memory capture · conversation",
      status: "success",
      startedAt: 0,
      children: [],
      depth: 1,
    };

    expect(classifyPrimitive("memory.capture")).toBe("memory-capture");
    expect(classifyPrimitive("memory.write")).toBe("memory");
    expect(semanticKindFor(treeNode)).toBe("memory");
  });

  it.each([
    ["inline", "inline", "completed"],
    ["inline-fallback", "deferred", "completed"],
    ["retained", "deferred", "completed"],
    ["eval-captured", "deferred", "captured"],
  ] as const)(
    "accepts the %s disposition",
    (disposition, requestedMode, outcome) => {
      const view = memoryCaptureFromNode(
        captureNode({
          ...baseAttributes,
          requestedMode,
          disposition,
          outcome,
        }),
        new Set(["memory:conversation"]),
      );

      expect(view).toEqual(
        expect.objectContaining({
          memoryId: "conversation",
          operation: "turn",
          requestedMode,
          disposition,
          outcome,
          sequence: 7,
          blockCount: 2,
          toolEventCount: 1,
          durationMs: 30,
          memory: expect.objectContaining({
            value: "memory:conversation",
            role: "invoked-memory",
            resolved: true,
          }),
        }),
      );
    },
  );

  it.each([
    ["unknown disposition", { disposition: "queued" }],
    ["unknown requested mode", { requestedMode: "background" }],
    ["unknown operation", { operation: "message" }],
    ["unknown outcome", { outcome: "ignored" }],
    ["fractional count", { blockCount: 1.5 }],
    ["string count", { toolEventCount: "1" }],
    ["missing memory id", { memoryId: "" }],
  ])("fails closed for %s", (_label, override) => {
    expect(
      memoryCaptureFromNode(
        captureNode({
          ...baseAttributes,
          disposition: "retained",
          outcome: "completed",
          ...override,
        }),
      ),
    ).toBeUndefined();
  });
});
