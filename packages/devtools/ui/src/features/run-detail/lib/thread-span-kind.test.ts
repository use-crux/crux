import { describe, expect, it } from "vitest";
import { semanticKindFor } from "@/features/run-detail/components/SpanTree";
import type { SpanNode } from "@/features/observability/lib/span-tree";
import { primitiveFamily } from "@/features/run-detail/lib/families";

function node(primitive: string): SpanNode {
  return {
    id: `node:${primitive}`,
    kind: "trace",
    primitive,
    label: primitive,
    status: "success",
    startedAt: 0,
    children: [],
    depth: 1,
  };
}

describe("thread span Run Detail projection", () => {
  it.each([
    "thread.operation",
    "thread.append",
    "thread.read",
    "thread.edit",
    "thread.select",
    "thread.redact",
    "thread.delete",
  ])("tags %s as a thread span in the state family", (primitive) => {
    expect(semanticKindFor(node(primitive))).toBe("thread");
    expect(primitiveFamily(primitive)).toBe("state");
  });

  it("keeps unrelated primitives out of the thread tag", () => {
    expect(semanticKindFor(node("memory.write"))).toBe("memory");
    expect(semanticKindFor(node("plan.update"))).not.toBe("thread");
  });
});

describe("Connected Knowledge span Run Detail projection", () => {
  it.each([
    "knowledge.expand-relations",
    "knowledge.global-search",
    "knowledge.derive",
    "knowledge.compile",
  ])("tags %s as a retrieval span in the capabilities family", (primitive) => {
    expect(semanticKindFor(node(primitive))).toBe("retrieval");
    expect(primitiveFamily(primitive)).toBe("capabilities");
  });
});
