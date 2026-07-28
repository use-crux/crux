import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupPromptTextDiagnosticFixtures,
  promptTextDiagnosticFacts,
} from "./prompt-text-diagnostic-test-support";

afterEach(cleanupPromptTextDiagnosticFixtures);

describe("PromptText sequence diagnostics", () => {
  it("points at the first guaranteed invalid required tuple leaf", async () => {
    const { facts } = await promptTextDiagnosticFacts(
      [
        `import { md, prompt } from "@use-crux/core"`,
        `const values = [[true] as const, "safe"] as const`,
        `export const writer = prompt({ id: "writer", prompt: md\`\${values}\` })`,
        `export const direct = prompt({ id: "direct", prompt: md\`\${(["safe", true] as const)}\` })`,
      ].join("\n"),
    );

    expect(facts.diagnostics).toEqual([
      expect.objectContaining({
        relatedDefinitionIds: ["prompt:writer"],
        code: "CRUX_PROMPT_TEXT_INVALID_INTERPOLATION",
        message:
          "PromptText interpolation 0[0][0] is always invalid (boolean). Use a string, finite number, PromptText fragment, false, null, undefined, or a supported sequence.",
        evidence: expect.objectContaining({
          interpolationPath: [0, 0],
          cause: {
            kind: "invalid-interpolation",
            runtimeKinds: ["boolean"],
          },
        }),
      }),
      expect.objectContaining({
        relatedDefinitionIds: ["prompt:direct"],
        evidence: expect.objectContaining({
          interpolationPath: [1],
        }),
      }),
    ]);
  });

  it("diagnoses only normalized inline sequence positions", async () => {
    const { facts } = await promptTextDiagnosticFacts(
      [
        `import { md, prompt } from "@use-crux/core"`,
        `declare const values: string[]`,
        `export const inline = prompt({ id: "inline", prompt: md\`Values: \${values}\` })`,
        `export const block = prompt({ id: "block", prompt: md\`Heading\\n\${values}\\nTail\` })`,
      ].join("\n"),
    );

    expect(facts.diagnostics).toEqual([
      expect.objectContaining({
        code: "CRUX_PROMPT_TEXT_INLINE_SEQUENCE",
        message:
          "PromptText interpolation 0 is a sequence in inline position. Move it to its own line or join supported scalar values explicitly.",
        relatedDefinitionIds: ["prompt:inline"],
        evidence: expect.objectContaining({
          cause: {
            kind: "inline-sequence",
            joinableWithComma: true,
          },
        }),
      }),
    ]);
  });

  it("offers comma joins only for proven scalar element domains", async () => {
    const { facts } = await promptTextDiagnosticFacts(
      [
        `import { md, prompt, type PromptText } from "@use-crux/core"`,
        `declare const strings: string[]`,
        `declare const brandedStrings: string[] & { readonly context: "test" }`,
        `declare const literals: (1 | 2)[]`,
        `declare const tuple: [string, 1]`,
        `declare const numbers: number[]`,
        `declare const optional: [string?]`,
        `declare const rest: [string, ...string[]]`,
        `declare const nullable: (string | null)[]`,
        `declare const fragments: PromptText[]`,
        `declare const nested: string[][]`,
        `declare const empty: []`,
        `function generic<T extends string[]>(values: T) { return md\`Values: \${values}\` }`,
        `export const stringsPrompt = prompt({ id: "strings", prompt: md\`Values: \${strings}\` })`,
        `export const brandedStringsPrompt = prompt({ id: "branded-strings", prompt: md\`Values: \${brandedStrings}\` })`,
        `export const literalsPrompt = prompt({ id: "literals", prompt: md\`Values: \${literals}\` })`,
        `export const tuplePrompt = prompt({ id: "tuple", prompt: md\`Values: \${tuple}\` })`,
        `export const numbersPrompt = prompt({ id: "numbers", prompt: md\`Values: \${numbers}\` })`,
        `export const optionalPrompt = prompt({ id: "optional", prompt: md\`Values: \${optional}\` })`,
        `export const restPrompt = prompt({ id: "rest", prompt: md\`Values: \${rest}\` })`,
        `export const nullablePrompt = prompt({ id: "nullable", prompt: md\`Values: \${nullable}\` })`,
        `export const fragmentsPrompt = prompt({ id: "fragments", prompt: md\`Values: \${fragments}\` })`,
        `export const nestedPrompt = prompt({ id: "nested", prompt: md\`Values: \${nested}\` })`,
        `export const emptyPrompt = prompt({ id: "empty", prompt: md\`Values: \${empty}\` })`,
        `export const genericPrompt = prompt({ id: "generic", prompt: generic })`,
      ].join("\n"),
    );

    expect(
      Object.fromEntries(
        (facts.diagnostics ?? []).map((diagnostic) => [
          diagnostic.relatedDefinitionIds?.[0],
          diagnostic.evidence?.cause,
        ]),
      ),
    ).toEqual({
      "prompt:strings": {
        kind: "inline-sequence",
        joinableWithComma: true,
      },
      "prompt:branded-strings": {
        kind: "inline-sequence",
        joinableWithComma: true,
      },
      "prompt:literals": {
        kind: "inline-sequence",
        joinableWithComma: true,
      },
      "prompt:tuple": {
        kind: "inline-sequence",
        joinableWithComma: true,
      },
      "prompt:numbers": { kind: "inline-sequence" },
      "prompt:optional": { kind: "inline-sequence" },
      "prompt:rest": { kind: "inline-sequence" },
      "prompt:nullable": { kind: "inline-sequence" },
      "prompt:fragments": { kind: "inline-sequence" },
      "prompt:nested": { kind: "inline-sequence" },
      "prompt:empty": { kind: "inline-sequence" },
      "prompt:generic": { kind: "inline-sequence" },
    });
  });

  it("does not invent guaranteed leaves from optional, rest, or recursive elements", async () => {
    const { facts } = await promptTextDiagnosticFacts(
      [
        `import { md, prompt } from "@use-crux/core"`,
        `declare const optional: [true?]`,
        `declare const restOnly: [...true[]]`,
        `declare const requiredThenRest: [true, ...string[]]`,
        `declare const invalidArray: true[]`,
        `type Recursive = readonly [Recursive?]`,
        `declare const recursive: Recursive`,
        `export const optionalPrompt = prompt({ id: "optional", prompt: md\`Values: \${optional}\` })`,
        `export const restPrompt = prompt({ id: "rest", prompt: md\`Values: \${restOnly}\` })`,
        `export const requiredPrompt = prompt({ id: "required", prompt: md\`Values: \${requiredThenRest}\` })`,
        `export const inlineArrayPrompt = prompt({ id: "inline-array", prompt: md\`Values: \${invalidArray}\` })`,
        `export const blockArrayPrompt = prompt({ id: "block-array", prompt: md\`\\n\${invalidArray}\\n\` })`,
        `export const recursivePrompt = prompt({ id: "recursive", prompt: md\`Values: \${recursive}\` })`,
      ].join("\n"),
    );

    expect(
      Object.fromEntries(
        (facts.diagnostics ?? []).map((diagnostic) => [
          diagnostic.relatedDefinitionIds?.[0],
          diagnostic.evidence?.cause.kind === "invalid-interpolation"
            ? {
                kind: diagnostic.evidence.cause.kind,
                path: diagnostic.evidence.interpolationPath,
              }
            : { kind: diagnostic.evidence?.cause.kind },
        ]),
      ),
    ).toEqual({
      "prompt:optional": { kind: "inline-sequence" },
      "prompt:rest": { kind: "inline-sequence" },
      "prompt:required": {
        kind: "invalid-interpolation",
        path: [0],
      },
      "prompt:inline-array": { kind: "inline-sequence" },
      "prompt:recursive": { kind: "inline-sequence" },
    });
  });

  it("requires one shared tuple path across every union member", async () => {
    const { facts } = await promptTextDiagnosticFacts(
      [
        `import { md, prompt } from "@use-crux/core"`,
        `declare const sharedPath: [true] | [1n]`,
        `declare const differentPaths: [true, string] | [string, true]`,
        `declare const mixedValue: [true] | string`,
        `export const shared = prompt({ id: "shared", prompt: md\`Values: \${sharedPath}\` })`,
        `export const different = prompt({ id: "different", prompt: md\`Values: \${differentPaths}\` })`,
        `export const mixed = prompt({ id: "mixed", prompt: md\`Values: \${mixedValue}\` })`,
      ].join("\n"),
    );

    expect(
      (facts.diagnostics ?? []).map((diagnostic) => ({
        owner: diagnostic.relatedDefinitionIds?.[0],
        evidence: diagnostic.evidence,
      })),
    ).toEqual([
      {
        owner: "prompt:shared",
        evidence: expect.objectContaining({
          interpolationPath: [0],
          cause: {
            kind: "invalid-interpolation",
            runtimeKinds: ["boolean", "bigint"],
          },
        }),
      },
      {
        owner: "prompt:different",
        evidence: expect.objectContaining({
          cause: { kind: "inline-sequence" },
        }),
      },
    ]);
  });

  it("rejects comma joins when authored nullable syntax is compiler-erased", async () => {
    const { facts } = await promptTextDiagnosticFacts(
      [
        `import { md, prompt } from "@use-crux/core"`,
        `declare function nullableValues(): (string | null)[]`,
        `const nullableAlias = ["value", null] as string[]`,
        `export const asserted = prompt({ id: "asserted", prompt: md\`Values: \${([] as (string | null)[])}\` })`,
        `export const returned = prompt({ id: "returned", prompt: md\`Values: \${nullableValues()}\` })`,
        `export const aliased = prompt({ id: "aliased", prompt: md\`Values: \${nullableAlias}\` })`,
      ].join("\n"),
    );

    expect(
      (facts.diagnostics ?? []).map((diagnostic) => ({
        owner: diagnostic.relatedDefinitionIds?.[0],
        cause: diagnostic.evidence?.cause,
      })),
    ).toEqual([
      {
        owner: "prompt:asserted",
        cause: { kind: "inline-sequence" },
      },
      {
        owner: "prompt:returned",
        cause: { kind: "inline-sequence" },
      },
      {
        owner: "prompt:aliased",
        cause: { kind: "inline-sequence" },
      },
    ]);
  });
});
