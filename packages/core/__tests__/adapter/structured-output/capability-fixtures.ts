/**
 * Reusable structured-output capability profiles for compiler tests.
 *
 * `strictCapabilities` mirrors a provider that requires every property to be
 * listed in `required` and expresses optionality with a null union (OpenAI
 * strict shape). `permissiveCapabilities` mirrors a provider that natively
 * accepts optional properties. Both are authored once so lowering, decode, and
 * provider slices can share them.
 *
 * @module
 */

import type { StructuredOutputCapabilities } from "../../../src/adapter/structured-output";

/** Requires all properties in `required`; expresses optional via null union. */
export const strictCapabilities: StructuredOutputCapabilities = {
  id: "test.strict",
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
};

/** Natively accepts optional properties (absent from `required`). */
export const permissiveCapabilities: StructuredOutputCapabilities = {
  id: "test.permissive",
  supportsJsonSchema: true,
  requiresAllProperties: false,
  supportsOptionalProperties: true,
  supportsNullable: true,
  supportsBooleanSchemas: true,
  supportsReferences: true,
  supportsUnions: true,
  supportsRecursiveSchemas: true,
  additionalProperties: "supported",
  unsupportedKeywords: [],
};
