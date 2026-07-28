import { describe, expect, it } from "vitest";
import {
  IndexDiagnosticSchema,
  PromptTextDiagnosticEvidenceSchema,
} from "../../src/project-index";

describe("PromptText diagnostic evidence", () => {
  it("round-trips invalid interpolation evidence", () => {
    const evidence = {
      kind: "prompt-text",
      sourceRefId: "prompt:support:source:prompt",
      interpolationIndex: 2,
      interpolationPath: [0, 1],
      proof: "semantic-exact",
      cause: {
        kind: "invalid-interpolation",
        runtimeKinds: ["boolean", "object"],
      },
    } as const;

    expect(PromptTextDiagnosticEvidenceSchema.parse(evidence)).toEqual(
      evidence,
    );
  });

  it("round-trips inline sequence evidence", () => {
    const evidence = {
      kind: "prompt-text",
      sourceRefId: "prompt:support:source:prompt",
      interpolationIndex: 0,
      proof: "syntax-exact",
      cause: {
        kind: "inline-sequence",
        joinableWithComma: true,
      },
    } as const;

    expect(PromptTextDiagnosticEvidenceSchema.parse(evidence)).toEqual(
      evidence,
    );
  });

  it("round-trips JSON serialization evidence", () => {
    const evidence = {
      kind: "prompt-text",
      sourceRefId: "prompt:support:source:prompt",
      interpolationIndex: 1,
      proof: "semantic-exact",
      cause: {
        kind: "json-serialization",
        reason: "undefined-result",
      },
    } as const;

    expect(PromptTextDiagnosticEvidenceSchema.parse(evidence)).toEqual(
      evidence,
    );
  });

  it("retains evidence without changing outer diagnostic compatibility", () => {
    const evidence = {
      kind: "prompt-text",
      sourceRefId: "prompt:support:source:prompt",
      interpolationIndex: 0,
      proof: "semantic-exact",
      cause: {
        kind: "invalid-interpolation",
        runtimeKinds: ["boolean"],
      },
    } as const;

    const diagnostic = IndexDiagnosticSchema.parse({
      id: "prompt-text:example",
      severity: "error",
      code: "CRUX_PROMPT_TEXT_INVALID_INTERPOLATION",
      message: "Example",
      evidence,
      futureOuterField: true,
    });

    expect(diagnostic.evidence).toEqual(evidence);
  });
});
