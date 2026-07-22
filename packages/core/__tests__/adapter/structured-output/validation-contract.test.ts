/**
 * Structured-output validation contract (characterization).
 *
 * These tests encode the DESIRED normalization contract and are expected to FAIL
 * against current behavior. They document, executably, the two gaps this work
 * closes:
 *
 *  1. Validation currently runs only when `validationRetry` is configured
 *     (`generate-core.ts`: `else if (resolved.schema && validationRetry)`).
 *  2. `result.object` is currently the raw `JSON.parse` of provider text
 *     (`generate-core.ts`: `parsed = JSON.parse(lastExtracted.text)`), so authored
 *     Zod defaults, coercions, and transforms never reach `result.object`.
 *
 * They turn green once every completed candidate is routed through
 * decode → Safety → one `safeParse` and returns `safeParse.data`. Do not "fix"
 * them by weakening the assertions.
 *
 * @module
 */

import { describe, expect, it } from "vitest";

import {
  coercionSchema,
  createStructuredFakeAdapter,
  defaultSchema,
  structuredFixturePrompt,
  transformSchema,
} from "./normalization-fixtures";

const input = { message: "hello" } as const;

describe("structured output validation contract (phase 1 characterization)", () => {
  it("applies authored defaults to result.object without validationRetry", async () => {
    const result = await createStructuredFakeAdapter('{"answer":42}').generate(
      structuredFixturePrompt("default-fixture", defaultSchema),
      { model: "model-1", input },
    );

    // safeParse.data fills the default; raw JSON.parse omits `source`.
    expect(result.object).toEqual({ answer: 42, source: "unknown" });
  });

  it("applies authored transforms to result.object", async () => {
    const result = await createStructuredFakeAdapter('{"answer":21}').generate(
      structuredFixturePrompt("transform-fixture", transformSchema),
      { model: "model-1", input },
    );

    // safeParse.data reshapes via `.transform`; raw JSON.parse does not.
    expect(result.object).toEqual({ answer: 21, doubled: 42 });
  });

  it("applies authored coercions to result.object", async () => {
    const result = await createStructuredFakeAdapter('{"answer":"42"}').generate(
      structuredFixturePrompt("coercion-fixture", coercionSchema),
      { model: "model-1", input },
    );

    // safeParse.data coerces the string to a number; raw JSON.parse keeps "42".
    expect(result.object).toEqual({ answer: 42 });
    expect(typeof (result.object as { answer: unknown }).answer).toBe("number");
  });

  it("validates structured output even when validationRetry is absent", async () => {
    // Provider returns a value the schema must reject; no retry is configured.
    const run = createStructuredFakeAdapter('{"answer":"not-a-number"}').generate(
      structuredFixturePrompt("unconditional-validation", defaultSchema),
      { model: "model-1", input },
    );

    // Validation is unconditional: an invalid candidate must fail, not resolve
    // with an unvalidated object.
    await expect(run).rejects.toThrow();
  });
});
