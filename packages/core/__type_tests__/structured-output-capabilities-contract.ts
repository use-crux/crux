/**
 * Public type contract for structured-output capability profiles.
 *
 * Verifies the capability record is reachable from `@use-crux/core/adapter`,
 * checks every required field with `satisfies`, keeps closed-union literals
 * narrow, enforces the `additionalProperties` union, and rejects both missing
 * fields and invalid literals.
 */

import { expectTypeOf } from "vitest";
import type {
  AdditionalPropertiesSupport,
  StructuredOutputCapabilities,
} from "../src/adapter";

// A first-party profile authored with `satisfies` checks every required
// capability while keeping closed-union fields narrow.
const openAiStrict = {
  id: "openai.strict",
  supportsJsonSchema: true,
  requiresAllProperties: true,
  supportsOptionalProperties: false,
  supportsNullable: true,
  supportsBooleanSchemas: true,
  supportsReferences: true,
  supportsUnions: true,
  supportsRecursiveSchemas: false,
  additionalProperties: "must-be-false",
  unsupportedKeywords: [],
} satisfies StructuredOutputCapabilities;

// `satisfies` preserves the specific union member rather than widening it to
// the full `AdditionalPropertiesSupport` union.
expectTypeOf(openAiStrict.additionalProperties).toEqualTypeOf<"must-be-false">();

// The closed union admits exactly the three documented values.
expectTypeOf<AdditionalPropertiesSupport>().toEqualTypeOf<
  "supported" | "must-be-false" | "unsupported"
>();

// @ts-expect-error a missing required capability is rejected.
const _missingField: StructuredOutputCapabilities = {
  id: "provider.partial",
  supportsJsonSchema: true,
};
void _missingField;

const _invalidLiteral = {
  id: "provider.invalid",
  supportsJsonSchema: true,
  requiresAllProperties: true,
  supportsOptionalProperties: false,
  supportsNullable: true,
  supportsBooleanSchemas: true,
  supportsReferences: true,
  supportsUnions: true,
  supportsRecursiveSchemas: false,
  // @ts-expect-error additionalProperties is a closed union, not any string.
  additionalProperties: "maybe",
  unsupportedKeywords: [],
} satisfies StructuredOutputCapabilities;
void _invalidLiteral;

// Fields are readonly: assignment is a type error.
declare const caps: StructuredOutputCapabilities;
// @ts-expect-error capability fields are readonly.
caps.supportsJsonSchema = false;
