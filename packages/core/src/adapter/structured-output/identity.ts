/**
 * Compilation identity and fingerprinting.
 *
 * A compilation fingerprint is a stable hash over the semantic inputs and
 * decisions of one compilation: the canonical schema, the full capability
 * profile, the compiler and manifest versions, and the applied lowering
 * decisions. It deliberately excludes non-semantic object identity and
 * request-local values so equivalent inputs always produce the same fingerprint.
 *
 * @module
 */

import type { StructuredOutputCapabilities } from "./capabilities";
import type { JsonSchemaObject, StructuredOutputDecodeManifest } from "./plan";

/** Compiler version; bump when lowering or canonical output changes meaning. */
export const STRUCTURED_OUTPUT_COMPILER_VERSION = 1;

/** Decode manifest version; bump when the operation set changes shape. */
export const STRUCTURED_OUTPUT_MANIFEST_VERSION = 1;

/** Inputs that define a compilation's stable identity. */
export interface StructuredOutputFingerprintInput {
  /** The canonical (pre-lowering) JSON Schema. */
  readonly canonicalSchema: JsonSchemaObject;
  /** The full capability profile the schema was compiled against. */
  readonly capabilities: StructuredOutputCapabilities;
  /** The decode manifest produced by lowering. */
  readonly manifest: StructuredOutputDecodeManifest;
  /** Stable identifiers of the lowering decisions applied, in document order. */
  readonly loweringDecisions: readonly string[];
}

/**
 * Compute a stable fingerprint for one compilation.
 *
 * @remarks
 * Uses an order-independent canonical serialization so semantically equal inputs
 * hash identically. Bias is toward over-invalidation: any change to the schema,
 * profile, versions, or lowering decisions changes the fingerprint.
 */
export function structuredOutputFingerprint(
  input: StructuredOutputFingerprintInput,
): string {
  const payload = {
    schema: input.canonicalSchema,
    profile: input.capabilities,
    manifest: input.manifest,
    lowering: input.loweringDecisions,
    compilerVersion: STRUCTURED_OUTPUT_COMPILER_VERSION,
    manifestVersion: STRUCTURED_OUTPUT_MANIFEST_VERSION,
  };
  return `so${STRUCTURED_OUTPUT_COMPILER_VERSION}_${hash(
    canonicalStringify(payload),
  )}`;
}

/** Serialize a value to a canonical string with recursively sorted object keys. */
function canonicalStringify(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalStringify(record[key])}`)
    .join(",")}}`;
}

/** djb2 string hash rendered as fixed-width hex, matching repo fingerprints. */
function hash(input: string): string {
  let value = 5381;
  for (let index = 0; index < input.length; index++) {
    value = (value * 33) ^ input.charCodeAt(index);
  }
  return (value >>> 0).toString(16).padStart(8, "0");
}
