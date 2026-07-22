/**
 * Structured-output compilation entry point.
 *
 * Compiles one authored Zod schema against one provider capability profile into
 * an immutable plan: a validated profile, a canonical JSON Schema, a (currently
 * empty) decode manifest, diagnostics, and a stable fingerprint. Semantic
 * lowering is layered on top of this skeleton; the canonical schema is emitted
 * as-is until then.
 *
 * @module
 */

import type { z } from "zod";
import type { StructuredOutputCapabilities } from "./capabilities";
import type { StructuredOutputDiagnostic } from "./diagnostics";
import type { StructuredOutputDecodeManifest, StructuredOutputPlan } from "./plan";
import { validateStructuredOutputCapabilities } from "./validate-profile";
import { CruxUnsupportedStructuredOutputError } from "./errors";
import { toCanonicalJsonSchema } from "./canonical-schema";
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
 */
export function compileStructuredOutput(
  authoredSchema: z.ZodType,
  capabilities: StructuredOutputCapabilities,
): StructuredOutputPlan {
  validateStructuredOutputCapabilities(capabilities);
  if (!capabilities.supportsJsonSchema) {
    throw new CruxUnsupportedStructuredOutputError(capabilities.id);
  }

  const canonicalSchema = toCanonicalJsonSchema(authoredSchema);
  const decodeManifest: StructuredOutputDecodeManifest = {
    version: STRUCTURED_OUTPUT_MANIFEST_VERSION,
    operations: [],
  };
  const diagnostics: readonly StructuredOutputDiagnostic[] = [];
  const fingerprint = structuredOutputFingerprint({
    canonicalSchema,
    capabilities,
    manifest: decodeManifest,
    loweringDecisions: [],
  });

  return deepFreeze({
    outputSchema: canonicalSchema,
    decodeManifest,
    diagnostics,
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
