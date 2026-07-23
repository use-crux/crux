/**
 * Structured-output compilation entry point.
 *
 * Compiles one authored Zod schema against one provider capability profile into
 * an immutable plan: the profile is validated for coherence, the schema is
 * converted to a canonical JSON Schema and lowered for the profile (dropping
 * unsupported keywords, normalizing `additionalProperties`, and encoding
 * optional-only properties as required+nullable), producing a reversible decode
 * manifest, lowering diagnostics, and a stable fingerprint. Unsupported
 * semantics (recursion/references, unions, nullable, boolean schemas the profile
 * cannot represent) are rejected here, before any provider request.
 *
 * @module
 */

import type { z } from "zod";
import type { StructuredOutputCapabilities } from "./capabilities";
import type {
  JsonSchemaObject,
  StructuredOutputDecodeManifest,
  StructuredOutputPlan,
} from "./plan";
import { validateStructuredOutputCapabilities } from "./validate-profile";
import { CruxUnsupportedStructuredOutputError } from "./errors";
import { toCanonicalJsonSchema } from "./canonical-schema";
import { lowerForCapabilities } from "./lower";
import {
  STRUCTURED_OUTPUT_MANIFEST_VERSION,
  structuredOutputFingerprint,
} from "./identity";

/**
 * Compile an authored schema into a provider-compatible structured-output plan.
 *
 * @param authoredSchema - The authored Zod output (or tool input) schema. It is
 *   never mutated and remains the sole semantic validator.
 * @param capabilities - The provider's inert capability profile.
 * @returns A frozen {@link StructuredOutputPlan}.
 * @throws {CruxInvalidCapabilityProfileError} When the profile is contradictory.
 * @throws {CruxUnsupportedStructuredOutputError} When the profile cannot accept
 *   a JSON Schema for structured output.
 * @throws {CruxUnsupportedSchemaError} When the schema uses a semantic the
 *   profile cannot soundly represent (unsupported recursion/references, unions,
 *   nullable, or boolean schemas).
 */
export function compileStructuredOutput(
  authoredSchema: z.ZodType,
  capabilities: StructuredOutputCapabilities,
): StructuredOutputPlan {
  return compileCanonicalSchema(
    toCanonicalJsonSchema(authoredSchema),
    capabilities,
  );
}

/**
 * Compile a canonical JSON Schema (rather than an authored Zod type) against a
 * capability profile, sharing the exact lowering kernel: profile validation,
 * capability lowering, decode manifest, diagnostics, and fingerprint. Used for
 * raw and `jsonSchema(...)`-wrapped tool input schemas, which receive wire
 * lowering and a decode manifest but no authored Zod validator.
 *
 * @param options.rawSchema - When true, the input is a caller-authored raw JSON
 *   Schema (not derived from Zod), so lowering enforces a closed supported
 *   vocabulary and rejects constructs it cannot soundly represent before any
 *   provider request. The caller must pass a schema it owns exclusively; it is
 *   frozen as part of the returned plan.
 * @throws {CruxInvalidCapabilityProfileError} When the profile is contradictory.
 * @throws {CruxUnsupportedStructuredOutputError} When the profile cannot accept
 *   a JSON Schema for structured output.
 * @throws {CruxUnsupportedSchemaError} When the schema uses a semantic the
 *   profile cannot soundly represent.
 */
export function compileCanonicalSchema(
  canonicalSchema: JsonSchemaObject,
  capabilities: StructuredOutputCapabilities,
  options?: { readonly rawSchema?: boolean },
): StructuredOutputPlan {
  validateStructuredOutputCapabilities(capabilities);
  if (!capabilities.supportsJsonSchema) {
    throw new CruxUnsupportedStructuredOutputError(capabilities.id);
  }

  const lowered = lowerForCapabilities(canonicalSchema, capabilities, {
    rawSchema: options?.rawSchema ?? false,
  });
  const decodeManifest: StructuredOutputDecodeManifest = {
    version: STRUCTURED_OUTPUT_MANIFEST_VERSION,
    operations: lowered.operations,
  };
  const fingerprint = structuredOutputFingerprint({
    canonicalSchema,
    capabilities,
    manifest: decodeManifest,
    loweringDecisions: lowered.decisions,
  });

  return deepFreeze({
    outputSchema: lowered.outputSchema,
    decodeManifest,
    diagnostics: lowered.diagnostics,
    fingerprint,
  });
}

/** Recursively freeze a plan so callers cannot mutate any nested structure. */
function deepFreeze<T extends object>(value: T): T {
  Object.freeze(value);
  for (const nested of Object.values(value)) {
    if (nested && typeof nested === "object" && !Object.isFrozen(nested)) {
      deepFreeze(nested as object);
    }
  }
  return value;
}
