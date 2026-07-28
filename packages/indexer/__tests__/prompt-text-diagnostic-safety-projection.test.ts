import { describe, expect, it } from "vitest";
import { projectPromptTextDiagnosticConclusions } from "../src/indexer/semantic/evidence/prompt-text-diagnostics";

const baseConclusion = {
  kind: "prompt-text-diagnostic",
  definitionId: "prompt:writer",
  sourceRefId: "prompt:writer:source:prompt",
  owner: {
    role: "prompt",
    property: "prompt",
    lifecycle: "static",
  },
  proof: "semantic-exact",
} as const;

describe("PromptText diagnostic safety", () => {
  it("keeps diagnostics hard, edit-free, and outside blocked wording", () => {
    const diagnostics = projectPromptTextDiagnosticConclusions([
      {
        ...baseConclusion,
        interpolation: {
          index: 0,
          source: { file: "src/index.ts", line: 1, column: 1 },
        },
        cause: {
          kind: "invalid-interpolation",
          runtimeKinds: ["boolean"],
        },
      },
      {
        ...baseConclusion,
        definitionId: "prompt:sequence",
        sourceRefId: "prompt:sequence:source:prompt",
        interpolation: {
          index: 0,
          source: { file: "src/index.ts", line: 2, column: 1 },
        },
        cause: { kind: "inline-sequence" },
      },
      {
        ...baseConclusion,
        definitionId: "prompt:json",
        sourceRefId: "prompt:json:source:prompt",
        interpolation: {
          index: 0,
          source: { file: "src/index.ts", line: 3, column: 1 },
        },
        cause: {
          kind: "json-serialization",
          reason: "undefined-result",
        },
      },
    ]);
    const prohibited = [
      "sanitize",
      "sanitization",
      "encode",
      "encoding",
      "escape",
      "escaping",
      "trust",
      "trusted",
      "raw",
      "xml",
      "safe",
      "safety",
      "nested input",
      "double-encoding",
    ];

    for (const diagnostic of diagnostics) {
      expect(diagnostic.severity).toBe("error");
      expect(diagnostic).not.toHaveProperty("suggestedFix");
      const inspected = [
        diagnostic.code,
        diagnostic.message,
        JSON.stringify(diagnostic.suggestedFix),
      ]
        .join("\n")
        .toLowerCase();

      for (const term of prohibited) expect(inspected).not.toContain(term);
    }
  });
});
