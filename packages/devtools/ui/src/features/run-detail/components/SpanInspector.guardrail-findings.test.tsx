import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  ObservabilityRunDetail,
  ObservabilityRunDetailNode,
} from "@/types";
import { SpanInspector } from "./SpanInspector";

vi.mock("@/shared/query/useProjectDefinitionIds", () => ({
  useProjectDefinitionIds: () => new Set<string>(),
}));

describe("SpanInspector guardrail findings", () => {
  it("renders repeated matches in authored order without duplicate keys", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      const html = renderToStaticMarkup(
        <SpanInspector
          runDetail={runDetailWithClassifierFindings()}
          selectedNodeId={null}
          onSelectSpan={() => undefined}
        />,
      );

      expect(html.match(/>match</g)).toHaveLength(2);
      expect(html).toContain("graphic-violence · 0.91 ≥ 0.90");
      expect(html).toContain("sexual-content · 0.88 ≥ 0.85");
      expect(html.indexOf("graphic-violence")).toBeLessThan(
        html.indexOf("sexual-content"),
      );
      expect(html).toContain(
        'style="color:var(--devtools-warn)">not inspected',
      );
      expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(
        /same key|unique[^.]*key/i,
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});

function runDetailWithClassifierFindings(): ObservabilityRunDetail {
  const root = {
    id: "generation:classifier",
    kind: "generation",
    primitive: "generate",
    status: "ok",
    display: { kind: "generation", label: "Generation" },
    timing: { startedAt: "2026-07-27T00:00:00.000Z", durationMs: 12 },
    metricBuckets: {},
    source: { placementReason: "primary" },
    details: [],
    artifacts: [
      {
        kind: "guardrail.report",
        preview: {
          kind: "guardrail.report",
          action: "block",
          findings: [
            {
              type: "media_classifier_match",
              category: "graphic-violence",
              score: 0.91,
              threshold: 0.9,
            },
            {
              type: "media_classifier_match",
              category: "sexual-content",
              score: 0.88,
              threshold: 0.85,
            },
            { type: "media_not_inspected" },
          ],
        },
      },
    ],
    events: [],
    relations: [],
    diagnostics: [],
    children: [],
  } as unknown as ObservabilityRunDetailNode;

  return {
    root,
    definitionRefs: [],
  } as unknown as ObservabilityRunDetail;
}
