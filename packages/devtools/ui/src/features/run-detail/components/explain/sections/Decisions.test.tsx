import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  normalizeTurnDecisionReport,
  type RuntimeTurnDecisionReport,
} from "@/features/run-detail/lib/explain/report";
import { DecisionRow } from "./Decisions";

describe("DecisionRow Safety provenance", () => {
  it("renders the semantic facts from a normalized Go-shaped report", () => {
    const report = {
      schemaVersion: 1,
      reportId: "tdr:run_guardrail_safety:span_generation",
      runId: "run_guardrail_safety",
      traceId: "trace_guardrail_safety",
      turn: {
        id: "span_generation",
        kind: "generation.call",
        name: "generate guarded answer",
        status: "ok",
        durMs: 500,
      },
      saw: [],
      considered: [],
      freshness: [],
      cache: [],
      decisions: [
        {
          id: "decision:span_generation:guardrail:span_guardrail",
          phase: "checks",
          kind: "guardrail.run",
          subject: {
            kind: "guardrail",
            id: "span_guardrail",
            name: "sanitize-retrieval",
          },
          outcome: "transform",
          reason: {
            code: "guardrail.redacted",
            text: "guardrail decision was observed.",
            source: "span-attribute",
            evidenceLevel: "observed",
          },
          safety: {
            target: { id: "model.input.text", label: "Model input · Text" },
            mode: "enforce",
            changed: true,
            origin: {
              source: "retrieval",
              kind: "retrieval-context",
              retrieverId: "docs",
              blockIndex: 0,
              segmentIndex: 3,
            },
          },
          tab: { tab: "Guardrail", spanId: "span_guardrail" },
        },
      ],
      source: [],
      coverage: { covered: 0, total: 6, areas: [] },
      gaps: [],
    } satisfies RuntimeTurnDecisionReport;

    const normalized = normalizeTurnDecisionReport(report);
    const decision = normalized?.decisions[0];
    if (!decision) throw new Error("normalized Go report omitted its decision");

    const html = renderToStaticMarkup(<DecisionRow decision={decision} />);

    expect(html).toContain("Model input · Text");
    expect(html).toContain("Retrieval");
    expect(html).toContain("docs");
    expect(html).toContain("enforce · changed");
  });
});
