/**
 * Devtools adapter for the shared Static Index parity normalizer.
 *
 * The canonicalization contract lives in `@crux/indexer/contracts/parity` so
 * devtools scripts and host parity tests compare the same semantic surfaces.
 *
 * @module
 */

import { canonicalStaticExtractionJson } from '@crux/indexer/contracts/parity'

/**
 * Serializes static extraction parity payloads with the shared fail-closed
 * normalizer.
 *
 * @param value - Static extraction projection to serialize.
 * @returns JSON with stable object key ordering, unordered fact sorting, and
 * normalized path separators.
 */
export function canonicalStaticJson(value: unknown): string {
  return canonicalStaticExtractionJson(value as Parameters<typeof canonicalStaticExtractionJson>[0])
}
