import { describe, expect, it } from "vitest";
import type { TurnDecisionReport } from "@/types";
import { turnHasWarningSignal, turnInitialTab } from "./signals";

/** Minimal clean report — everything present, current, protected. */
function cleanReport(): TurnDecisionReport {
  return {
    schemaVersion: 1,
    reportId: "tdr:run:gen",
    runId: "run",
    turn: { id: "gen", kind: "generation.call", status: "ok" },
    saw: [],
    considered: [],
    freshness: [],
    cache: [],
    decisions: [],
    source: [],
    coverage: { covered: 6, total: 6, areas: [] },
    gaps: [],
  };
}

describe("turnInitialTab", () => {
  it("opens Output for a clean, healthy turn", () => {
    expect(turnInitialTab(cleanReport())).toBe("output");
  });

  it("opens Explain when the turn status is not ok", () => {
    const r = cleanReport();
    r.turn.status = "error";
    expect(turnInitialTab(r)).toBe("explain");
  });

  it("opens Output when there is no report at all", () => {
    expect(turnInitialTab(undefined)).toBe("output");
  });
});

describe("turnHasWarningSignal", () => {
  it("is false for a clean turn", () => {
    expect(turnHasWarningSignal(cleanReport())).toBe(false);
  });

  it("is true when evidence was used while stale", () => {
    const r = cleanReport();
    r.freshness = [
      { subject: { kind: "tool", id: "tool:acct" }, status: "stale-used" },
    ];
    expect(turnHasWarningSignal(r)).toBe(true);
  });

  it("is true when a required context was dropped", () => {
    const r = cleanReport();
    r.considered = [
      {
        kind: "context",
        id: "context:history",
        disposition: "dropped",
        required: true,
        evidenceLevel: "declared",
        sourceStatus: "dropped",
      },
    ];
    expect(turnHasWarningSignal(r)).toBe(true);
  });

  it("is false when a non-required context was dropped", () => {
    const r = cleanReport();
    r.considered = [
      {
        kind: "context",
        id: "context:faq",
        disposition: "dropped",
        evidenceLevel: "observed",
        sourceStatus: "dropped",
      },
    ];
    expect(turnHasWarningSignal(r)).toBe(false);
  });

  it("is true when a fallback fired", () => {
    const r = cleanReport();
    r.decisions = [
      {
        id: "d",
        phase: "recovery",
        kind: "routing",
        subject: { kind: "route", name: "fallback" },
        outcome: "primary errored → tier 2",
        reason: {
          code: "routing.fallback.fired",
          text: "fell back",
          source: "artifact",
          evidenceLevel: "declared",
        },
      },
    ];
    expect(turnHasWarningSignal(r)).toBe(true);
  });

  it("is true when a guardrail or security check blocked", () => {
    const r = cleanReport();
    r.decisions = [
      {
        id: "d",
        phase: "checks",
        kind: "security",
        subject: { kind: "security-check", name: "input" },
        outcome: "blocked",
        reason: {
          code: "security.blocked",
          text: "blocked",
          source: "artifact",
          evidenceLevel: "declared",
        },
      },
    ];
    expect(turnHasWarningSignal(r)).toBe(true);
  });

  it("is true when a safety guardrail rewrote output", () => {
    const r = cleanReport();
    r.decisions = [
      {
        id: "decision:safety:1:pii:model.output.text",
        phase: "checks",
        kind: "safety.guardrail",
        subject: { kind: "guardrail", id: "pii", name: "pii" },
        outcome: "rewrite",
        reason: {
          code: "guardrail.redacted",
          text: "Guardrail pii rewrite on model.output.text.",
          source: "artifact",
          evidenceLevel: "declared",
        },
      },
    ];
    expect(turnInitialTab(r)).toBe("explain");
    expect(turnHasWarningSignal(r)).toBe(true);
  });
});
