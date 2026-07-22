/**
 * Provider structured-output capability profile.
 *
 * A capability profile is inert, public, composable data describing the JSON
 * Schema dialect a provider accepts for structured output. Core owns the finite
 * lowering rules keyed off these flags; a provider package only describes what
 * it accepts and can never inject an executable rewrite.
 *
 * @module
 */

/**
 * How a provider treats `additionalProperties` on object wire schemas.
 *
 * - `supported` — any `additionalProperties` value is accepted.
 * - `must-be-false` — objects must set `additionalProperties: false`.
 * - `unsupported` — the keyword must be omitted entirely.
 */
export type AdditionalPropertiesSupport =
  | "supported"
  | "must-be-false"
  | "unsupported";

/**
 * The JSON Schema behavior a provider accepts for structured output.
 *
 * Author first-party profiles as `readonly` records with `satisfies
 * StructuredOutputCapabilities` so literal values stay narrow while every
 * required capability is checked. The `id` is stable and participates in
 * compilation fingerprints and diagnostics.
 *
 * @remarks
 * These flags are consumed by the compiler, never by a network request. If a
 * provider cannot accept JSON Schema at all, set `supportsJsonSchema: false`;
 * compilation then fails before any request is built.
 */
export interface StructuredOutputCapabilities {
  /** Stable identity included in compilation fingerprints and diagnostics. */
  readonly id: string;
  /** Whether the provider accepts a JSON Schema for structured output at all. */
  readonly supportsJsonSchema: boolean;
  /** Whether every object property must be listed in `required`. */
  readonly requiresAllProperties: boolean;
  /** Whether properties absent from `required` are accepted. */
  readonly supportsOptionalProperties: boolean;
  /** Whether a `null` type/union is accepted in the wire schema. */
  readonly supportsNullable: boolean;
  /** Whether a boolean schema (`true`/`false`) is accepted in a schema position. */
  readonly supportsBooleanSchemas: boolean;
  /** Whether `$ref`/`$defs` references are accepted rather than fully inlined. */
  readonly supportsReferences: boolean;
  /** Whether `anyOf`/`oneOf` unions are accepted. */
  readonly supportsUnions: boolean;
  /** Whether self-referential (recursive) schemas are accepted. */
  readonly supportsRecursiveSchemas: boolean;
  /** How the provider treats `additionalProperties` on objects. */
  readonly additionalProperties: AdditionalPropertiesSupport;
  /** JSON Schema keywords the provider rejects and the compiler must drop. */
  readonly unsupportedKeywords: readonly string[];
}
