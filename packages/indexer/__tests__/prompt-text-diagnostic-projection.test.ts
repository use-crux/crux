import { describe, expect, it } from "vitest";
import {
  projectPromptTextDiagnosticConclusions,
  type PromptTextDiagnosticConclusion,
} from "../src/indexer/semantic/evidence/prompt-text-diagnostics";

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

describe("PromptText diagnostic projection", () => {
  it("freezes the canonical JSON diagnostic identity", () => {
    expect(
      projectPromptTextDiagnosticConclusions([
        {
          ...baseConclusion,
          interpolation: {
            index: 0,
            source: {
              file: "src/index.ts",
              line: 5,
              column: 22,
            },
          },
          cause: {
            kind: "json-serialization",
            reason: "undefined-result",
          },
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        id: "prompt-text:1c1ed4b776ee0c9627fe2858d5d78f82c79f471030233d1a01ce631e37c906c6",
      }),
    ]);
  });

  it("freezes invalid-path and inline-sequence projections", () => {
    expect(
      projectPromptTextDiagnosticConclusions([
        {
          ...baseConclusion,
          interpolation: {
            index: 3,
            path: [1, 2],
            source: { file: "src/index.ts", line: 8, column: 15 },
          },
          cause: {
            kind: "invalid-interpolation",
            runtimeKinds: ["boolean", "object"],
          },
        },
        {
          ...baseConclusion,
          definitionId: "prompt:sequence",
          sourceRefId: "prompt:sequence:source:prompt",
          interpolation: {
            index: 1,
            source: { file: "src/sequence.ts", line: 4, column: 9 },
          },
          cause: {
            kind: "inline-sequence",
            joinableWithComma: true,
          },
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        id: "prompt-text:59c974ba0c6dc54f4cf11a98945f85129e8cca8630898c2dddba15da1aff7265",
        message:
          "PromptText interpolation 3[1][2] is always invalid (boolean, object). Use a string, finite number, PromptText fragment, false, null, undefined, or a supported sequence.",
      }),
      expect.objectContaining({
        id: "prompt-text:004ef159bbc1e687c62763913f9c2616b980922444e1631409e2f7410695e3a4",
        message:
          "PromptText interpolation 1 is a sequence in inline position. Move it to its own line or join supported scalar values explicitly.",
      }),
    ]);
  });

  it("deduplicates with JSON then earliest required-path precedence", () => {
    const interpolation = {
      index: 0,
      source: { file: "src/index.ts", line: 3, column: 12 },
    } as const;
    const conclusions = [
      {
        ...baseConclusion,
        interpolation,
        cause: { kind: "inline-sequence" },
      },
      {
        ...baseConclusion,
        interpolation: { ...interpolation, path: [1] },
        cause: {
          kind: "invalid-interpolation",
          runtimeKinds: ["boolean"],
        },
      },
      {
        ...baseConclusion,
        interpolation,
        cause: {
          kind: "json-serialization",
          reason: "undefined-result",
        },
      },
      {
        ...baseConclusion,
        definitionId: "prompt:tuple",
        sourceRefId: "prompt:tuple:source:prompt",
        interpolation: { ...interpolation, path: [2] },
        cause: {
          kind: "invalid-interpolation",
          runtimeKinds: ["object"],
        },
      },
      {
        ...baseConclusion,
        definitionId: "prompt:tuple",
        sourceRefId: "prompt:tuple:source:prompt",
        interpolation: { ...interpolation, path: [0] },
        cause: {
          kind: "invalid-interpolation",
          runtimeKinds: ["boolean"],
        },
      },
    ] as const;

    expect(
      projectPromptTextDiagnosticConclusions(conclusions).map((diagnostic) => ({
        owner: diagnostic.relatedDefinitionIds?.[0],
        code: diagnostic.code,
        path: diagnostic.evidence?.interpolationPath,
      })),
    ).toEqual([
      {
        owner: "prompt:tuple",
        code: "CRUX_PROMPT_TEXT_INVALID_INTERPOLATION",
        path: [0],
      },
      {
        owner: "prompt:writer",
        code: "CRUX_PROMPT_TEXT_JSON_SERIALIZATION",
      },
    ]);
  });

  it("suppresses unrepresentable identity and noncanonical evidence", () => {
    type InvalidConclusion = Extract<
      PromptTextDiagnosticConclusion,
      { readonly cause: { readonly kind: "invalid-interpolation" } }
    >;
    const invalid = (overrides: {
      readonly definitionId?: string;
      readonly sourceRefId?: string;
      readonly interpolation?: InvalidConclusion["interpolation"];
      readonly cause?: InvalidConclusion["cause"];
    }): InvalidConclusion => ({
      ...baseConclusion,
      interpolation: {
        index: 0,
        source: { file: "src/index.ts", line: 1, column: 1 },
      },
      cause: {
        kind: "invalid-interpolation",
        runtimeKinds: ["boolean"],
      },
      ...overrides,
    });

    expect(
      projectPromptTextDiagnosticConclusions([
        invalid({ definitionId: "" }),
        invalid({ sourceRefId: "" }),
        invalid({
          interpolation: {
            index: 0,
            source: { file: "", line: 1, column: 1 },
          },
        }),
        invalid({
          interpolation: {
            index: 0,
            source: { file: "src/index.ts", line: 0, column: 1 },
          },
        }),
        invalid({
          interpolation: {
            index: 2_147_483_648,
            source: { file: "src/index.ts", line: 1, column: 1 },
          },
        }),
        invalid({
          interpolation: {
            index: 0,
            path: [],
            source: { file: "src/index.ts", line: 1, column: 1 },
          },
        }),
        invalid({
          cause: {
            kind: "invalid-interpolation",
            runtimeKinds: ["object", "boolean"],
          },
        }),
      ]),
    ).toEqual([]);
  });

  it("does not let an unrepresentable winner suppress valid evidence", () => {
    expect(
      projectPromptTextDiagnosticConclusions([
        {
          ...baseConclusion,
          interpolation: {
            index: 0,
            source: {
              file: "src/index.ts",
              line: 0x1_0000_0000,
              column: 1,
            },
          },
          cause: {
            kind: "json-serialization",
            reason: "undefined-result",
          },
        },
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
      ]),
    ).toEqual([
      expect.objectContaining({
        code: "CRUX_PROMPT_TEXT_INVALID_INTERPOLATION",
      }),
    ]);
  });
});
