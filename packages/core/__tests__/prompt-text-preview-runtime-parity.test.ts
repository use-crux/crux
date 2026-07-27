import { describe, expect, it } from "vitest";
import { md, type PromptText } from "../src/prompt-text";
import { lowerPromptText } from "../src/prompt-text/internal";
import fixture from "./fixtures/prompt-text-preview-runtime-v1.json";

type RuntimeValue =
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "false" }
  | { readonly kind: "null" }
  | { readonly kind: "undefined" }
  | { readonly kind: "array"; readonly value: readonly RuntimeValue[] }
  | { readonly kind: "json"; readonly value: unknown }
  | {
      readonly kind: "fragment";
      readonly quasis: readonly string[];
      readonly values: readonly RuntimeValue[];
    };

interface RuntimeCase {
  readonly name: string;
  readonly quasis: readonly string[];
  readonly values: readonly RuntimeValue[];
  readonly text: string;
}

interface RuntimeFixture {
  readonly version: "crux-prompt-text-preview-runtime-v1";
  readonly cases: readonly RuntimeCase[];
}

const runtimeFixture = fixture as RuntimeFixture;

describe("PromptText static-preview runtime parity", () => {
  it("renders every shared preview fixture byte-for-byte", () => {
    expect(runtimeFixture.version).toBe("crux-prompt-text-preview-runtime-v1");
    for (const testCase of runtimeFixture.cases) {
      const rendered = lowerPromptText(renderTemplate(testCase));
      expect(rendered.text, testCase.name).toBe(testCase.text);
      expect(
        rendered.segments.map(({ text }) => text).join(""),
        `${testCase.name} segment reconstruction`,
      ).toBe(rendered.text);
    }
  });
});

function renderTemplate(
  template: Pick<RuntimeCase, "quasis" | "values">,
): PromptText {
  const strings = [...template.quasis] as unknown as TemplateStringsArray;
  Object.defineProperty(strings, "raw", { value: [...template.quasis] });
  const values = template.values.map(renderValue);
  return (
    md as unknown as (
      strings: TemplateStringsArray,
      ...values: readonly unknown[]
    ) => PromptText
  )(strings, ...values);
}

function renderValue(value: RuntimeValue): unknown {
  switch (value.kind) {
    case "string":
    case "number":
      return value.value;
    case "false":
      return false;
    case "null":
      return null;
    case "undefined":
      return undefined;
    case "array":
      return value.value.map(renderValue);
    case "json":
      return md.json(value.value);
    case "fragment":
      return renderTemplate(value);
  }
}
