import { describe, expect, it } from "vitest";
import type { SpanNode } from "@/features/observability/lib/span-tree";
import { semanticKindFor } from "./SpanTree";

describe("SpanTree Effect classification", () => {
  it("renders effect.run as a first-class Effect row", () => {
    const node = {
      id: "span_effect",
      kind: "trace",
      primitive: "effect.run",
      label: "payments.charge",
      status: "success",
      startedAt: 0,
      children: [],
      depth: 1,
    } satisfies SpanNode;

    expect(semanticKindFor(node)).toBe("effect");
  });
});
