import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupPromptTextDiagnosticFixtures,
  promptTextDiagnosticFacts,
} from "./prompt-text-diagnostic-test-support";

afterEach(cleanupPromptTextDiagnosticFixtures);

describe("PromptText invalid interpolation diagnostics", () => {
  it("diagnoses literal true with exact md.json applicability", async () => {
    const { facts } = await promptTextDiagnosticFacts(
      [
        `import { md, prompt } from "@use-crux/core"`,
        `export const writer = prompt({ id: "writer", prompt: md\`\${true}\` })`,
      ].join("\n"),
    );

    expect(facts.diagnostics).toEqual([
      expect.objectContaining({
        code: "CRUX_PROMPT_TEXT_INVALID_INTERPOLATION",
        message:
          "PromptText interpolation 0 is always invalid (boolean). Use a string, finite number, PromptText fragment, false, null, undefined, or a supported sequence.",
        evidence: expect.objectContaining({
          interpolationIndex: 0,
          cause: {
            kind: "invalid-interpolation",
            runtimeKinds: ["boolean"],
            mdJsonApplicable: true,
          },
        }),
      }),
    ]);
  });

  it("emits the closed invalid runtime vocabulary in canonical order", async () => {
    const { facts } = await promptTextDiagnosticFacts(
      [
        `import { md, prompt } from "@use-crux/core"`,
        `declare const combined: true | 1n | symbol | (() => void) | { value: string }`,
        `export const combinedPrompt = prompt({ id: "combined", prompt: md\`\${combined}\` })`,
        `export const nonfinitePrompt = prompt({ id: "nonfinite", prompt: md\`\${-Infinity}\` })`,
        `export const promisePrompt = prompt({ id: "promise", prompt: md\`\${Promise.resolve("value")}\` })`,
      ].join("\n"),
    );

    const invalidCauses = facts.diagnostics?.map(
      (diagnostic) => diagnostic.evidence?.cause,
    );
    expect(invalidCauses).toEqual([
      {
        kind: "invalid-interpolation",
        runtimeKinds: ["boolean", "bigint", "symbol", "function", "object"],
      },
      {
        kind: "invalid-interpolation",
        runtimeKinds: ["non-finite-number"],
        mdJsonApplicable: true,
      },
      {
        kind: "invalid-interpolation",
        runtimeKinds: ["object"],
      },
    ]);
  });

  it("suppresses accepted and uncertain value possibilities", async () => {
    const { facts } = await promptTextDiagnosticFacts(
      [
        `import { md, prompt } from "@use-crux/core"`,
        `declare const anyValue: any`,
        `declare const unknownValue: unknown`,
        `declare const mixed: string | true`,
        `declare const broadNumber: number`,
        `declare const broadBoolean: boolean`,
        `declare const broadObject: object`,
        `declare const emptyObject: {}`,
        `declare const impossible: never`,
        `type BrandedString = string & { readonly brand: unique symbol }`,
        `type BrandedFragment = import("@use-crux/core").PromptText & { readonly context: "test" }`,
        `declare const brandedString: BrandedString`,
        `declare const brandedFragment: BrandedFragment`,
        `const fragment = md\`fragment\``,
        `function generic<T>(value: T) { return md\`\${value}\` }`,
        `export const anyPrompt = prompt({ id: "any", prompt: md\`\${anyValue}\` })`,
        `export const unknownPrompt = prompt({ id: "unknown", prompt: md\`\${unknownValue}\` })`,
        `export const mixedPrompt = prompt({ id: "mixed", prompt: md\`\${mixed}\` })`,
        `export const numberPrompt = prompt({ id: "number", prompt: md\`\${broadNumber}\` })`,
        `export const booleanPrompt = prompt({ id: "boolean", prompt: md\`\${broadBoolean}\` })`,
        `export const objectPrompt = prompt({ id: "object", prompt: md\`\${broadObject}\` })`,
        `export const emptyPrompt = prompt({ id: "empty", prompt: md\`\${emptyObject}\` })`,
        `export const neverPrompt = prompt({ id: "never", prompt: md\`\${impossible}\` })`,
        `export const stringPrompt = prompt({ id: "string", prompt: md\`\${brandedString}\` })`,
        `export const fragmentPrompt = prompt({ id: "fragment", prompt: md\`\${fragment}\` })`,
        `export const brandedFragmentPrompt = prompt({ id: "branded-fragment", prompt: md\`\${brandedFragment}\` })`,
        `export const voidPrompt = prompt({ id: "void", prompt: md\`\${void 0}\` })`,
        `export const genericPrompt = prompt({ id: "generic", prompt: generic })`,
      ].join("\n"),
    );

    expect(facts.diagnostics).toEqual([]);
  });

  it("limits md.json applicability to exact whole-expression syntax", async () => {
    const { facts } = await promptTextDiagnosticFacts(
      [
        `import { md, prompt } from "@use-crux/core"`,
        `const exactTrue = true`,
        `const nonfiniteAlias = Infinity`,
        `const shadowed = (Infinity: number) => md\`\${Infinity}\``,
        `export const trueAlias = prompt({ id: "true-alias", prompt: md\`\${exactTrue}\` })`,
        `export const wrappedTrue = prompt({ id: "wrapped-true", prompt: md\`\${(true as true)}\` })`,
        `export const nan = prompt({ id: "nan", prompt: md\`\${NaN}\` })`,
        `export const infinity = prompt({ id: "infinity", prompt: md\`\${Infinity}\` })`,
        `export const positive = prompt({ id: "positive", prompt: md\`\${+Infinity}\` })`,
        `export const negative = prompt({ id: "negative", prompt: md\`\${-Infinity}\` })`,
        `export const overflow = prompt({ id: "overflow", prompt: md\`\${1e999}\` })`,
        `export const alias = prompt({ id: "alias", prompt: md\`\${nonfiniteAlias}\` })`,
        `export const nested = prompt({ id: "nested", prompt: md\`\${[true] as const}\` })`,
        `export const shadowedPrompt = prompt({ id: "shadowed", prompt: shadowed })`,
      ].join("\n"),
    );

    const causes = Object.fromEntries(
      (facts.diagnostics ?? []).map((diagnostic) => [
        diagnostic.relatedDefinitionIds?.[0],
        diagnostic.evidence?.cause,
      ]),
    );
    for (const definitionId of [
      "prompt:true-alias",
      "prompt:wrapped-true",
      "prompt:nan",
      "prompt:infinity",
      "prompt:positive",
      "prompt:negative",
      "prompt:overflow",
    ]) {
      expect(causes[definitionId]).toMatchObject({ mdJsonApplicable: true });
    }
    expect(causes["prompt:nested"]).toEqual({
      kind: "invalid-interpolation",
      runtimeKinds: ["boolean"],
    });
    expect(causes).not.toHaveProperty("prompt:alias");
    expect(causes).not.toHaveProperty("prompt:shadowed");
  });

  it("reduces aliases, enums, intersections, and callable shapes conservatively", async () => {
    const { facts } = await promptTextDiagnosticFacts(
      [
        `import { md, prompt } from "@use-crux/core"`,
        `type ObjectAlias = { value: string }`,
        `type ObjectIntersection = ObjectAlias & { readonly brand: "object" }`,
        `type NumberIntersection = number & { readonly brand: "number" }`,
        `type Callable = { (): void; readonly name: string }`,
        `class Example { value = "example" }`,
        `enum Text { Value = "value" }`,
        `enum Count { One = 1, Two = 2 }`,
        `declare const objectIntersection: ObjectIntersection`,
        `declare const numberIntersection: NumberIntersection`,
        `declare const callable: Callable`,
        `declare const mixed: string | ObjectAlias`,
        `declare const impossible: string & number`,
        `export const objectPrompt = prompt({ id: "object", prompt: md\`\${objectIntersection}\` })`,
        `export const callablePrompt = prompt({ id: "callable", prompt: md\`\${callable}\` })`,
        `export const classPrompt = prompt({ id: "class", prompt: md\`\${new Example()}\` })`,
        `export const numberPrompt = prompt({ id: "number", prompt: md\`\${numberIntersection}\` })`,
        `export const textEnumPrompt = prompt({ id: "text-enum", prompt: md\`\${Text.Value}\` })`,
        `export const countEnumPrompt = prompt({ id: "count-enum", prompt: md\`\${Count.One}\` })`,
        `export const mixedPrompt = prompt({ id: "mixed", prompt: md\`\${mixed}\` })`,
        `export const neverPrompt = prompt({ id: "never", prompt: md\`\${impossible}\` })`,
      ].join("\n"),
    );

    expect(
      (facts.diagnostics ?? []).map((diagnostic) => ({
        owner: diagnostic.relatedDefinitionIds?.[0],
        kinds:
          diagnostic.evidence?.cause.kind === "invalid-interpolation"
            ? diagnostic.evidence.cause.runtimeKinds
            : [],
      })),
    ).toEqual([
      { owner: "prompt:object", kinds: ["object"] },
      { owner: "prompt:callable", kinds: ["function"] },
      { owner: "prompt:class", kinds: ["object"] },
    ]);
  });

  it("distinguishes nominal empty objects from broad structural emptiness", async () => {
    const { facts } = await promptTextDiagnosticFacts(
      [
        `import { md, prompt } from "@use-crux/core"`,
        `interface EmptyInterface {}`,
        `class EmptyClass {}`,
        `namespace local { export interface Array<T> { readonly value: T } }`,
        `declare const emptyInterface: EmptyInterface`,
        `declare const emptyStructural: {}`,
        `declare const fakeArray: local.Array<string>`,
        `export const interfacePrompt = prompt({ id: "interface", prompt: md\`\${emptyInterface}\` })`,
        `export const classPrompt = prompt({ id: "class", prompt: md\`\${new EmptyClass()}\` })`,
        `export const structuralPrompt = prompt({ id: "structural", prompt: md\`\${emptyStructural}\` })`,
        `export const fakeArrayPrompt = prompt({ id: "fake-array", prompt: md\`\${fakeArray}\` })`,
        `export const assertedObjectPrompt = prompt({ id: "asserted-object", prompt: md\`\${({} as { value: string })}\` })`,
      ].join("\n"),
    );

    expect(
      (facts.diagnostics ?? []).map((diagnostic) => ({
        owner: diagnostic.relatedDefinitionIds?.[0],
        code: diagnostic.code,
      })),
    ).toEqual([
      {
        owner: "prompt:interface",
        code: "CRUX_PROMPT_TEXT_INVALID_INTERPOLATION",
      },
      {
        owner: "prompt:class",
        code: "CRUX_PROMPT_TEXT_INVALID_INTERPOLATION",
      },
      {
        owner: "prompt:fake-array",
        code: "CRUX_PROMPT_TEXT_INVALID_INTERPOLATION",
      },
      {
        owner: "prompt:asserted-object",
        code: "CRUX_PROMPT_TEXT_INVALID_INTERPOLATION",
      },
    ]);
  });
});
