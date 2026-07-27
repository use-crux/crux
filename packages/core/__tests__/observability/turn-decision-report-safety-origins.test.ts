import { describe, expect, it } from "vitest";
import type { ModelInputOrigin, ToolDescriptionOrigin } from "../../src/safety";
import { inputOriginAttributes } from "../../src/safety/input-origin-observability";
import { safetyDecisionToTurnDecision } from "../../src/observability/turn-decision-report";

describe("additional Safety origin observability", () => {
  it.each([
    [
      {
        source: "memory",
        kind: "memory-context",
        memoryId: "conversation",
        blockIndex: 1,
      },
      {
        inputSource: "memory",
        inputOriginKind: "memory-context",
        memoryId: "conversation",
        blockIndex: 1,
      },
    ],
    [
      {
        source: "memory",
        kind: "blackboard-context",
        boardId: "shared-plan",
        blockIndex: 2,
      },
      {
        inputSource: "memory",
        inputOriginKind: "blackboard-context",
        boardId: "shared-plan",
        blockIndex: 2,
      },
    ],
    [
      {
        source: "handoff",
        kind: "handoff-context",
        handoffId: "delegation-1",
        blockIndex: 3,
      },
      {
        inputSource: "handoff",
        inputOriginKind: "handoff-context",
        handoffId: "delegation-1",
        blockIndex: 3,
      },
    ],
    [
      {
        source: "feedback",
        kind: "rejected-output",
        attempt: 2,
      },
      {
        inputSource: "feedback",
        inputOriginKind: "rejected-output",
        attempt: 2,
      },
    ],
    [
      {
        source: "instructions",
        kind: "context",
        contextId: "authored-context",
        blockIndex: 4,
      },
      {
        inputSource: "instructions",
        inputOriginKind: "context",
        contextId: "authored-context",
        blockIndex: 4,
      },
    ],
  ] as const)(
    "projects %o using only fixed safe fields",
    (origin, expected) => {
      expect(inputOriginAttributes(origin as ModelInputOrigin)).toEqual(
        expected,
      );
    },
  );

  it("projects tool provenance and description category without schema paths", () => {
    const origin: ToolDescriptionOrigin = {
      source: "tool-definition",
      kind: "discovered",
      toolName: "search",
      sourceId: "catalog",
      sourceKind: "registry",
      descriptionKind: "schema",
      schemaDepth: 2,
    };

    expect(inputOriginAttributes(origin)).toEqual({
      inputSource: "tool-definition",
      inputOriginKind: "discovered",
      toolName: "search",
      toolSourceId: "catalog",
      toolSourceKind: "registry",
      descriptionKind: "schema",
      schemaDepth: 2,
    });
  });

  it("keeps memory and feedback subject text out of turn decisions", () => {
    const rows = [
      {
        origin: {
          source: "memory",
          kind: "memory-context",
          memoryId: "conversation",
        } as const,
        preview: "PRIVATE_MEMORY_CONTENT",
      },
      {
        origin: {
          source: "feedback",
          kind: "constraint-feedback",
          attempt: 1,
        } as const,
        preview: "PRIVATE_FEEDBACK_CONTENT",
      },
    ].map(({ origin, preview }, index) =>
      safetyDecisionToTurnDecision({
        policyId: `private-origin-${index}`,
        kind: "guardrail",
        boundary: "model.input.text",
        origin,
        mode: "enforce",
        action: "allow",
        durationMs: 1,
        captured: {
          level: "safe",
          sizeBytes: preview.length,
          hash: "safe-hash",
          preview,
          raw: preview,
        },
      }),
    );

    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain("PRIVATE_MEMORY_CONTENT");
    expect(serialized).not.toContain("PRIVATE_FEEDBACK_CONTENT");
    expect(rows.map((row) => row.safety?.origin)).toEqual([
      {
        source: "memory",
        kind: "memory-context",
        memoryId: "conversation",
      },
      {
        source: "feedback",
        kind: "constraint-feedback",
        attempt: 1,
      },
    ]);
  });
});
