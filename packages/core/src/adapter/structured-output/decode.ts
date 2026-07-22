/**
 * Provider value decoding.
 *
 * Applies a plan's decode manifest to a provider value, reversing transport-only
 * lowering before Safety and original Zod parsing. Decoding never mutates the
 * provider value: it uses copy-on-write, cloning only the ancestors of changed
 * occurrences. With an empty manifest it returns the original value reference.
 *
 * @module
 */

import type { StructuredOutputDecodeManifest } from "./plan";

/**
 * Decode a completed provider value against a plan's decode manifest.
 *
 * @param value - The provider value to decode (never mutated).
 * @param manifest - The plan's reversible decode manifest.
 * @returns The canonical `z.input`. With an empty manifest, the exact same
 *   reference is returned.
 */
export function decodeStructuredValue<T>(
  value: T,
  manifest: StructuredOutputDecodeManifest,
): T {
  if (manifest.operations.length === 0) return value;
  // Operation application is introduced together with the optional-property
  // lowering that produces these operations; no plan emits them yet.
  throw new Error(
    "structured-output decode manifest operations are not supported in this build",
  );
}
