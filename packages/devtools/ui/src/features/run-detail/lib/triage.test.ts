import { describe, expect, it } from "vitest";
import type { SpanNode } from "@/features/observability/lib/span-tree";
import {
  collectFailingSpanIds,
  flatStatuses,
  nodesOnFailurePath,
  stepFailure,
} from "./triage";

function node(
  id: string,
  status: SpanNode["status"],
  children: SpanNode[] = [],
  depth = 0,
): SpanNode {
  return {
    id,
    kind: "composition",
    label: id,
    status,
    startedAt: 0,
    children,
    depth,
  };
}

// root
// ├─ plan (success)
// └─ sections (error)
//    ├─ a (success)
//    └─ sec (error)
//       └─ draft (error)   ← the failing leaf
const tree = node("root", "error", [
  node("plan", "success", [], 1),
  node(
    "sections",
    "error",
    [
      node("a", "success", [], 2),
      node("sec", "error", [node("draft", "error", [], 3)], 2),
    ],
    1,
  ),
]);

describe("collectFailingSpanIds", () => {
  it("lists failing spans pre-order, top→bottom", () => {
    expect(collectFailingSpanIds(tree)).toEqual([
      "root",
      "sections",
      "sec",
      "draft",
    ]);
  });
});

describe("nodesOnFailurePath", () => {
  it("keeps every ancestor of a failure, drops clean siblings", () => {
    const keep = nodesOnFailurePath(tree);
    expect(keep.has("root")).toBe(true);
    expect(keep.has("sections")).toBe(true);
    expect(keep.has("sec")).toBe(true);
    expect(keep.has("draft")).toBe(true);
    // Clean spans off the failure path are not kept expanded.
    expect(keep.has("plan")).toBe(false);
    expect(keep.has("a")).toBe(false);
  });

  it("is empty when nothing failed", () => {
    expect(
      nodesOnFailurePath(node("ok", "success", [node("c", "success", [], 1)]))
        .size,
    ).toBe(0);
  });
});

describe("flatStatuses", () => {
  it("emits one status per span, pre-order over the whole tree", () => {
    expect(flatStatuses(tree)).toEqual([
      "error",
      "success",
      "error",
      "success",
      "error",
      "error",
    ]);
  });
});

describe("stepFailure", () => {
  const failing = ["a", "b", "c"];

  it("advances and wraps forward", () => {
    expect(stepFailure(failing, "a", 1)).toBe("b");
    expect(stepFailure(failing, "c", 1)).toBe("a");
  });

  it("advances and wraps backward", () => {
    expect(stepFailure(failing, "b", -1)).toBe("a");
    expect(stepFailure(failing, "a", -1)).toBe("c");
  });

  it("jumps to the first/last failure when the selection is not a failure", () => {
    expect(stepFailure(failing, "other", 1)).toBe("a");
    expect(stepFailure(failing, null, -1)).toBe("c");
  });

  it("returns null with no failures", () => {
    expect(stepFailure([], "a", 1)).toBeNull();
  });
});
