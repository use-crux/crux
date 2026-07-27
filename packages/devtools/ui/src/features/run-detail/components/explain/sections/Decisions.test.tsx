import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  normalizeTurnDecisionReport,
  type RuntimeTurnDecisionReport,
} from "@/features/run-detail/lib/explain/report";
import type { TurnDecision } from "@/types";
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

  it("renders the friendly tool target and every content-free provenance label", () => {
    const origins = [
      { source: "memory", kind: "memory-context", memoryId: "conversation" },
      {
        source: "memory",
        kind: "blackboard-context",
        boardId: "shared-plan",
      },
      {
        source: "handoff",
        kind: "handoff-context",
        handoffId: "delegation-1",
      },
      { source: "feedback", kind: "rejected-output", attempt: 2 },
      {
        source: "tool-definition",
        kind: "authored",
        toolName: "lookup",
        descriptionKind: "tool",
      },
      {
        source: "tool-definition",
        kind: "discovered",
        toolName: "search",
        sourceId: "catalog",
        sourceKind: "registry",
        descriptionKind: "schema",
        schemaDepth: 2,
        schemaPath: "properties.private.description",
        content: "PRIVATE_SCHEMA_CONTENT",
      },
    ];
    const html = origins
      .map((origin, index) =>
        renderToStaticMarkup(
          <DecisionRow
            decision={safetyDecision(`decision-${index}`, origin)}
          />,
        ),
      )
      .join("");

    expect(html).toContain("Model input · Tools");
    for (const label of [
      "Memory",
      "Blackboard",
      "Handoff",
      "Feedback",
      "Authored tool",
      "Discovered tool",
    ]) {
      expect(html).toContain(label);
    }
    expect(html).not.toContain("model.input.tools");
    expect(html).not.toContain("properties.private");
    expect(html).not.toContain("PRIVATE_SCHEMA_CONTENT");
  });

  it("renders unknown future origins with safe generic copy", () => {
    const html = renderToStaticMarkup(
      <DecisionRow
        decision={safetyDecision("decision-future", {
          source: "future-secret-source",
          kind: "future-kind",
          content: "PRIVATE_FUTURE_CONTENT",
        })}
      />,
    );

    expect(html).toContain("Other source");
    expect(html).not.toContain("future-secret-source");
    expect(html).not.toContain("future-kind");
    expect(html).not.toContain("PRIVATE_FUTURE_CONTENT");
  });
});

function safetyDecision(
  id: string,
  origin: Record<string, unknown>,
): TurnDecision {
  return {
    id,
    phase: "checks",
    kind: "guardrail.run",
    subject: {
      kind: "guardrail",
      id: "tool-boundaries",
      name: "tool-boundaries",
    },
    outcome: "allow",
    reason: {
      code: "guardrail.allowed",
      text: "guardrail decision was observed.",
      source: "span-attribute",
      evidenceLevel: "observed",
    },
    safety: {
      target: { id: "model.input.tools", label: "model.input.tools" },
      mode: "enforce",
      changed: false,
      origin,
    },
  } as unknown as TurnDecision;
}
