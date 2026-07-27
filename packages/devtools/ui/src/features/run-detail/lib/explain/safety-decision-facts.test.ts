import { describe, expect, it } from "vitest";
import type { TurnDecision } from "@/types";
import { safetyDecisionFacts } from "./safety-decision-facts";

describe("safetyDecisionFacts", () => {
  it("renders a tool source badge and only its safe identifiers", () => {
    const facts = safetyDecisionFacts({
      safety: {
        target: { id: "model.input.text", label: "Model input · Text" },
        mode: "enforce",
        changed: true,
        origin: {
          source: "tool",
          kind: "tool-result",
          toolName: "search",
          toolCallId: "call-1",
        },
      },
    } as TurnDecision);

    expect(facts).toEqual({
      target: "Model input · Text",
      source: "Tool",
      identifier: "search · call-1",
      posture: "enforce · changed",
    });
    expect(JSON.stringify(facts)).not.toMatch(/content|arguments|result/i);
  });

  it("falls back to an unknown target and generic source without crashing", () => {
    const decision = {
      safety: {
        target: { id: "future.model.input", label: "" },
        mode: "report",
        changed: false,
        origin: { source: "future-source", kind: "future-kind" },
      },
    } as unknown as TurnDecision;

    expect(safetyDecisionFacts(decision)).toEqual({
      target: "future.model.input",
      source: "Other source",
      posture: "report",
    });
  });

  it.each([
    [
      { source: "memory", kind: "memory-context", memoryId: "conversation" },
      { source: "Memory", identifier: "conversation" },
    ],
    [
      { source: "memory", kind: "blackboard-context", boardId: "shared-plan" },
      { source: "Blackboard", identifier: "shared-plan" },
    ],
    [
      { source: "handoff", kind: "handoff-context", handoffId: "delegation-1" },
      { source: "Handoff", identifier: "delegation-1" },
    ],
    [
      { source: "feedback", kind: "rejected-output", attempt: 2 },
      { source: "Feedback", identifier: "attempt 2" },
    ],
    [
      {
        source: "tool-definition",
        kind: "authored",
        toolName: "lookup",
        descriptionKind: "tool",
      },
      { source: "Authored tool", identifier: "lookup · tool description" },
    ],
    [
      {
        source: "tool-definition",
        kind: "discovered",
        toolName: "search",
        sourceId: "catalog",
        sourceKind: "registry",
        descriptionKind: "schema",
        schemaDepth: 2,
        schemaPath: "properties.private.description",
      },
      {
        source: "Discovered tool",
        identifier:
          "search · catalog · registry · schema description · depth 2",
      },
    ],
  ] as const)("renders fixed safe facts for %o", (origin, expected) => {
    const facts = safetyDecisionFacts({
      safety: {
        target: { id: "model.input.tools", label: "model.input.tools" },
        mode: "enforce",
        changed: false,
        origin,
      },
    } as unknown as TurnDecision);

    expect(facts).toMatchObject(expected);
    expect(JSON.stringify(facts)).not.toContain("properties.private");
  });
});
