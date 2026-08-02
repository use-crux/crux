import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SpanNode } from "@/features/observability/lib/span-tree";
import { semanticKindFor, SpanTree } from "./SpanTree";

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

  it("renders a nested foreground child agent under its parent tool", () => {
    const child = {
      id: "child-agent",
      kind: "trace",
      primitive: "agent.run",
      label: "Research agent",
      status: "success",
      startedAt: 2,
      children: [],
      depth: 2,
    } satisfies SpanNode;
    const tree = {
      id: "parent-agent",
      kind: "trace",
      primitive: "agent.run",
      label: "Parent agent",
      status: "success",
      startedAt: 0,
      depth: 0,
      children: [{
        id: "delegate-tool",
        kind: "trace",
        primitive: "tool.call",
        label: "delegateResearch",
        status: "success",
        startedAt: 1,
        depth: 1,
        children: [child],
      }],
    } satisfies SpanNode;

    const html = renderToStaticMarkup(
      createElement(SpanTree, {
        tree,
        selectedId: null,
        onSelect: () => {},
        layout: "tree",
      }),
    );

    expect(html).toContain("Parent agent");
    expect(html).toContain("Research agent");
    expect((html.match(/>agent</g) ?? [])).toHaveLength(2);
  });
});
