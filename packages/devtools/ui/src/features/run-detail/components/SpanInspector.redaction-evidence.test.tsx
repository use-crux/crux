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

describe("SpanInspector redaction evidence", () => {
  it("renders evidence owned by a direct detail", () => {
    const html = renderToStaticMarkup(
      <SpanInspector
        runDetail={runDetailWithDetailRedaction()}
        selectedNodeId={null}
        onSelectSpan={() => undefined}
      />,
    );

    expect(html).toContain("Redacted");
    expect(html).toContain("Affected telemetry");
    expect(html).toContain("Error message");
  });
});

function runDetailWithDetailRedaction(): ObservabilityRunDetail {
  const root = {
    id: "generation:redacted-detail",
    spanId: "generation:redacted-detail",
    kind: "generation",
    primitive: "generation.call",
    status: "ok",
    display: { kind: "generation", label: "Generation" },
    timing: { startedAt: "2026-07-28T00:00:00.000Z", durationMs: 12 },
    metricBuckets: {},
    source: { placementReason: "primary" },
    details: [
      {
        spanId: "prompt:redacted",
        redaction: { applied: true, surfaces: ["error.message"] },
        artifacts: [],
      },
    ],
    artifacts: [],
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
