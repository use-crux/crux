/**
 * Cross-provider structured-output conformance table.
 *
 * Enumerates every first-party provider capability profile and pins the
 * lowering the compiler produces for a representative schema. The profiles below
 * mirror the source-of-truth declarations and must stay in sync with them:
 *
 * - `openai.chat-completions.strict` — `packages/openai/src/request.ts`
 * - `anthropic.messages.output-format` — `packages/anthropic/src/request-params.ts`
 * - `google.genai.response-json-schema` — `packages/google/src/request.ts`
 *
 * Core stays provider-agnostic and cannot import provider packages, so the table
 * is asserted here against copies rather than the exported constants.
 *
 * @module
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  compileStructuredOutput,
  validateStructuredOutputCapabilities,
  type StructuredOutputCapabilities,
} from "../../../src/adapter/structured-output";

const openai: StructuredOutputCapabilities = {
  id: "openai.chat-completions.strict",
  supportsJsonSchema: true,
  requiresAllProperties: true,
  supportsOptionalProperties: false,
  supportsNullable: true,
  supportsBooleanSchemas: false,
  supportsReferences: true,
  supportsUnions: true,
  supportsRecursiveSchemas: true,
  additionalProperties: "must-be-false",
  unsupportedKeywords: [],
};

const anthropic: StructuredOutputCapabilities = {
  id: "anthropic.messages.output-format",
  supportsJsonSchema: true,
  requiresAllProperties: false,
  supportsOptionalProperties: true,
  supportsNullable: true,
  supportsBooleanSchemas: false,
  supportsReferences: true,
  supportsUnions: true,
  supportsRecursiveSchemas: true,
  additionalProperties: "supported",
  unsupportedKeywords: [
    "minItems",
    "maxItems",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "multipleOf",
    "minLength",
    "maxLength",
    "pattern",
  ],
};

const google: StructuredOutputCapabilities = {
  id: "google.genai.response-json-schema",
  supportsJsonSchema: true,
  requiresAllProperties: false,
  supportsOptionalProperties: true,
  supportsNullable: true,
  supportsBooleanSchemas: false,
  supportsReferences: true,
  supportsUnions: true,
  supportsRecursiveSchemas: true,
  additionalProperties: "supported",
  unsupportedKeywords: [],
};

const PROFILES = [openai, anthropic, google];

// One schema that exercises optional lowering, string bounds, and array bounds.
const schema = z.object({
  title: z.string().min(3),
  tags: z.array(z.string()).min(1),
  note: z.string().optional(),
});

describe("cross-provider structured-output conformance", () => {
  it("every first-party profile is internally coherent", () => {
    for (const profile of PROFILES) {
      expect(() =>
        validateStructuredOutputCapabilities(profile),
      ).not.toThrow();
    }
  });

  it("openai strict lowers optional-only to required+nullable and pins additionalProperties", () => {
    const plan = compileStructuredOutput(schema, openai);
    expect(plan.outputSchema.required).toEqual(["title", "tags", "note"]);
    expect(plan.outputSchema.additionalProperties).toBe(false);
    expect(plan.decodeManifest.operations).toEqual([
      { kind: "delete-null-sentinel", path: ["note"] },
    ]);
    // Strict mode keeps validation keywords it accepts.
    expect(JSON.stringify(plan.outputSchema)).toContain("minLength");
  });

  it("anthropic keeps optionals and drops the keywords it rejects", () => {
    const plan = compileStructuredOutput(schema, anthropic);
    expect(plan.outputSchema.required).toEqual(["title", "tags"]);
    expect(plan.decodeManifest.operations).toEqual([]);
    const wire = JSON.stringify(plan.outputSchema);
    expect(wire).not.toContain("minLength");
    expect(wire).not.toContain("minItems");
  });

  it("google keeps optionals and all supported keywords with no lowering", () => {
    const plan = compileStructuredOutput(schema, google);
    expect(plan.outputSchema.required).toEqual(["title", "tags"]);
    expect(plan.decodeManifest.operations).toEqual([]);
    const wire = JSON.stringify(plan.outputSchema);
    expect(wire).toContain("minLength");
    expect(wire).toContain("minItems");
  });

  it("each profile compiles deterministically to a stable fingerprint", () => {
    for (const profile of PROFILES) {
      const a = compileStructuredOutput(schema, profile);
      const b = compileStructuredOutput(schema, profile);
      expect(a.fingerprint).toBe(b.fingerprint);
    }
    // Distinct profiles produce distinct compilation identities.
    const fingerprints = PROFILES.map(
      (profile) => compileStructuredOutput(schema, profile).fingerprint,
    );
    expect(new Set(fingerprints).size).toBe(PROFILES.length);
  });
});
