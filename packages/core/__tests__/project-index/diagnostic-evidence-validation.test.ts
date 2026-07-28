import { describe, expect, it } from "vitest";
import { PromptTextDiagnosticEvidenceSchema } from "../../src/project-index";

const invalidEvidence = {
  kind: "prompt-text",
  sourceRefId: "prompt:support:source:prompt",
  interpolationIndex: 0,
  proof: "semantic-exact",
  cause: {
    kind: "invalid-interpolation",
    runtimeKinds: ["boolean"],
  },
} as const;

describe("PromptText diagnostic evidence validation", () => {
  it("rejects unknown fields at every evidence object depth", () => {
    expect(
      PromptTextDiagnosticEvidenceSchema.safeParse({
        ...invalidEvidence,
        unexpected: true,
      }).success,
    ).toBe(false);
    expect(
      PromptTextDiagnosticEvidenceSchema.safeParse({
        ...invalidEvidence,
        cause: {
          ...invalidEvidence.cause,
          unexpected: true,
        },
      }).success,
    ).toBe(false);
  });

  it.each([
    ["empty source-ref ID", { ...invalidEvidence, sourceRefId: "" }],
    [
      "missing interpolation index",
      {
        kind: invalidEvidence.kind,
        sourceRefId: invalidEvidence.sourceRefId,
        proof: invalidEvidence.proof,
        cause: invalidEvidence.cause,
      },
    ],
    [
      "negative interpolation index",
      { ...invalidEvidence, interpolationIndex: -1 },
    ],
    [
      "fractional interpolation index",
      { ...invalidEvidence, interpolationIndex: 0.5 },
    ],
    [
      "oversized interpolation index",
      { ...invalidEvidence, interpolationIndex: 2_147_483_648 },
    ],
  ])("rejects %s", (_name, evidence) => {
    expect(PromptTextDiagnosticEvidenceSchema.safeParse(evidence).success).toBe(
      false,
    );
  });

  it.each([
    ["an empty path", []],
    ["a negative path segment", [-1]],
    ["a fractional path segment", [0.5]],
    ["an oversized path segment", [2_147_483_648]],
    ["more than 64 path segments", Array.from({ length: 65 }, () => 0)],
  ])("rejects invalid interpolation evidence with %s", (_name, path) => {
    expect(
      PromptTextDiagnosticEvidenceSchema.safeParse({
        ...invalidEvidence,
        interpolationPath: path,
      }).success,
    ).toBe(false);
  });

  it("accepts interpolation identity at every inclusive bound", () => {
    expect(
      PromptTextDiagnosticEvidenceSchema.safeParse({
        ...invalidEvidence,
        interpolationIndex: 2_147_483_647,
        interpolationPath: Array.from({ length: 64 }, () => 2_147_483_647),
      }).success,
    ).toBe(true);
  });

  it("rejects paths on causes that cannot identify nested leaves", () => {
    for (const cause of [
      { kind: "inline-sequence" },
      { kind: "json-serialization", reason: "undefined-result" },
    ] as const) {
      expect(
        PromptTextDiagnosticEvidenceSchema.safeParse({
          ...invalidEvidence,
          interpolationPath: [0],
          cause,
        }).success,
      ).toBe(false);
    }
  });

  it("accepts the complete canonical runtime-kind vocabulary", () => {
    expect(
      PromptTextDiagnosticEvidenceSchema.safeParse({
        ...invalidEvidence,
        cause: {
          kind: "invalid-interpolation",
          runtimeKinds: [
            "non-finite-number",
            "boolean",
            "bigint",
            "symbol",
            "function",
            "object",
            "cyclic-array",
          ],
        },
      }).success,
    ).toBe(true);
  });

  it.each([
    ["an empty set", []],
    ["duplicate kinds", ["boolean", "boolean"]],
    ["noncanonical ordering", ["object", "boolean"]],
    ["an unknown kind", ["promise"]],
  ])("rejects runtime kinds with %s", (_name, runtimeKinds) => {
    expect(
      PromptTextDiagnosticEvidenceSchema.safeParse({
        ...invalidEvidence,
        cause: {
          kind: "invalid-interpolation",
          runtimeKinds,
        },
      }).success,
    ).toBe(false);
  });

  it("limits md.json applicability to boolean and non-finite-number kinds", () => {
    for (const runtimeKinds of [
      ["boolean"],
      ["non-finite-number"],
      ["non-finite-number", "boolean"],
    ]) {
      expect(
        PromptTextDiagnosticEvidenceSchema.safeParse({
          ...invalidEvidence,
          cause: {
            kind: "invalid-interpolation",
            runtimeKinds,
            mdJsonApplicable: true,
          },
        }).success,
      ).toBe(true);
    }

    expect(
      PromptTextDiagnosticEvidenceSchema.safeParse({
        ...invalidEvidence,
        cause: {
          kind: "invalid-interpolation",
          runtimeKinds: ["boolean", "object"],
          mdJsonApplicable: true,
        },
      }).success,
    ).toBe(false);
  });

  it.each([
    ["unknown proof", { ...invalidEvidence, proof: "type-exact" }],
    [
      "false md.json flag",
      {
        ...invalidEvidence,
        cause: {
          ...invalidEvidence.cause,
          mdJsonApplicable: false,
        },
      },
    ],
    [
      "comma flag on invalid cause",
      {
        ...invalidEvidence,
        cause: {
          ...invalidEvidence.cause,
          joinableWithComma: true,
        },
      },
    ],
    [
      "false comma flag",
      {
        ...invalidEvidence,
        cause: {
          kind: "inline-sequence",
          joinableWithComma: false,
        },
      },
    ],
    [
      "md.json flag on sequence cause",
      {
        ...invalidEvidence,
        cause: {
          kind: "inline-sequence",
          mdJsonApplicable: true,
        },
      },
    ],
    [
      "foreign JSON reason",
      {
        ...invalidEvidence,
        cause: {
          kind: "json-serialization",
          reason: "threw",
        },
      },
    ],
  ])("rejects %s", (_name, evidence) => {
    expect(PromptTextDiagnosticEvidenceSchema.safeParse(evidence).success).toBe(
      false,
    );
  });
});
