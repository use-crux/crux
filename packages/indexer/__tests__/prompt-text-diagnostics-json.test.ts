import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupPromptTextDiagnosticFixtures,
  promptTextDiagnosticFacts,
} from "./prompt-text-diagnostic-test-support";

afterEach(cleanupPromptTextDiagnosticFixtures);

describe("PromptText md.json diagnostics", () => {
  it("accepts only canonical receiver aliases and transparent wrappers", async () => {
    const { facts } = await promptTextDiagnosticFacts(
      [
        `import { md, md as text, prompt } from "@use-crux/core"`,
        `import * as core from "@use-crux/core"`,
        `type MdTag = typeof md`,
        `export const alias = prompt({ id: "alias", prompt: md\`\${text.json(undefined)}\` })`,
        `export const namespace = prompt({ id: "namespace", prompt: md\`\${core.md.json(undefined)}\` })`,
        `export const asserted = prompt({ id: "asserted", prompt: md\`\${(md as MdTag).json(undefined)}\` })`,
        `export const satisfied = prompt({ id: "satisfied", prompt: md\`\${(md satisfies MdTag).json(undefined)}\` })`,
        `export const nonnull = prompt({ id: "nonnull", prompt: md\`\${md!.json(undefined)}\` })`,
        `export const receiverParens = prompt({ id: "receiver-parens", prompt: md\`\${(md).json(undefined)}\` })`,
        `export const calleeParens = prompt({ id: "callee-parens", prompt: md\`\${(md.json)(undefined)}\` })`,
      ].join("\n"),
    );

    expect(
      (facts.diagnostics ?? []).map(
        (diagnostic) => diagnostic.relatedDefinitionIds?.[0],
      ),
    ).toEqual([
      "prompt:alias",
      "prompt:namespace",
      "prompt:asserted",
      "prompt:satisfied",
      "prompt:nonnull",
      "prompt:receiver-parens",
      "prompt:callee-parens",
    ]);
    expect(
      (facts.diagnostics ?? []).every(
        (diagnostic) =>
          diagnostic.code === "CRUX_PROMPT_TEXT_JSON_SERIALIZATION",
      ),
    ).toBe(true);
  });

  it("accepts a canonical local re-export alias", async () => {
    const { facts } = await promptTextDiagnosticFacts(
      [
        `import { prompt } from "@use-crux/core"`,
        `import { text } from "./tags"`,
        `export const writer = prompt({ id: "writer", prompt: text\`\${text.json(undefined)}\` })`,
      ].join("\n"),
      {
        "src/tags.ts": `export { md as text } from "@use-crux/core"`,
      },
    );

    expect(facts.diagnostics).toEqual([
      expect.objectContaining({
        code: "CRUX_PROMPT_TEXT_JSON_SERIALIZATION",
        relatedDefinitionIds: ["prompt:writer"],
      }),
    ]);
  });

  it("rejects indirect, computed, optional, and malformed call shapes", async () => {
    const { facts } = await promptTextDiagnosticFacts(
      [
        `import { md, prompt } from "@use-crux/core"`,
        `const { json } = md`,
        `const property = md.json`,
        `const local = md`,
        `const wrapper = (value: typeof md) => value`,
        `const args = [undefined] as const`,
        `export const computed = prompt({ id: "computed", prompt: md\`\${md["json"](undefined)}\` })`,
        `export const optionalReceiver = prompt({ id: "optional-receiver", prompt: md\`\${md?.json(undefined)}\` })`,
        `export const optionalCall = prompt({ id: "optional-call", prompt: md\`\${md.json?.(undefined)}\` })`,
        `export const destructured = prompt({ id: "destructured", prompt: md\`\${json(undefined)}\` })`,
        `export const propertyAlias = prompt({ id: "property-alias", prompt: md\`\${property(undefined)}\` })`,
        `export const receiverAlias = prompt({ id: "receiver-alias", prompt: md\`\${local.json(undefined)}\` })`,
        `export const wrapped = prompt({ id: "wrapped", prompt: md\`\${wrapper(md).json(undefined)}\` })`,
        `export const callProperty = prompt({ id: "call-property", prompt: md\`\${md.json.call(undefined, undefined)}\` })`,
        `export const noArgs = prompt({ id: "no-args", prompt: md\`\${md.json()}\` })`,
        `export const twoArgs = prompt({ id: "two-args", prompt: md\`\${md.json(undefined, undefined)}\` })`,
        `export const spread = prompt({ id: "spread", prompt: md\`\${md.json(...args)}\` })`,
      ].join("\n"),
    );

    expect(facts.diagnostics).toEqual([]);
  });

  it("requires every argument possibility to stringify to undefined", async () => {
    const { facts } = await promptTextDiagnosticFacts(
      [
        `import { md, prompt, type PromptText } from "@use-crux/core"`,
        `declare const primitiveSymbol: symbol`,
        `declare const uniqueSymbol: unique symbol`,
        `declare const undefinedOrSymbol: undefined | symbol`,
        `declare const anyValue: any`,
        `declare const unknownValue: unknown`,
        `declare const mixed: undefined | string`,
        `declare const fragment: PromptText`,
        `declare function sideEffect(): string`,
        `function generic<T>(value: T) { return md\`\${md.json(value)}\` }`,
        `export const undefinedPrompt = prompt({ id: "undefined", prompt: md\`\${md.json(undefined)}\` })`,
        `export const voidPrompt = prompt({ id: "void", prompt: md\`\${md.json(void sideEffect())}\` })`,
        `export const symbolPrompt = prompt({ id: "symbol", prompt: md\`\${md.json(primitiveSymbol)}\` })`,
        `export const uniquePrompt = prompt({ id: "unique", prompt: md\`\${md.json(uniqueSymbol)}\` })`,
        `export const unionPrompt = prompt({ id: "union", prompt: md\`\${md.json(undefinedOrSymbol)}\` })`,
        `export const functionPrompt = prompt({ id: "function", prompt: md\`\${md.json(() => "value")}\` })`,
        `export const bigintPrompt = prompt({ id: "bigint", prompt: md\`\${md.json(1n)}\` })`,
        `export const objectPrompt = prompt({ id: "object", prompt: md\`\${md.json({ value: 1 })}\` })`,
        `export const arrayPrompt = prompt({ id: "array", prompt: md\`\${md.json([])}\` })`,
        `export const fragmentPrompt = prompt({ id: "fragment", prompt: md\`\${md.json(fragment)}\` })`,
        `export const anyPrompt = prompt({ id: "any", prompt: md\`\${md.json(anyValue)}\` })`,
        `export const unknownPrompt = prompt({ id: "unknown", prompt: md\`\${md.json(unknownValue)}\` })`,
        `export const mixedPrompt = prompt({ id: "mixed", prompt: md\`\${md.json(mixed)}\` })`,
        `export const genericPrompt = prompt({ id: "generic", prompt: generic })`,
      ].join("\n"),
    );

    expect(
      (facts.diagnostics ?? []).map(
        (diagnostic) => diagnostic.relatedDefinitionIds?.[0],
      ),
    ).toEqual([
      "prompt:undefined",
      "prompt:void",
      "prompt:symbol",
      "prompt:unique",
      "prompt:union",
    ]);
  });
});
