/**
 * Shared exact-preview limits expressed in their wire units.
 *
 * UTF-8 limits always count compact JSON or scalar bytes, never JavaScript
 * UTF-16 code units.
 *
 * @module
 */

export const PROMPT_PREVIEW_MAX_SCHEMA_BYTES = 65_536;
export const PROMPT_PREVIEW_MAX_TARGETS = 512;
export const PROMPT_PREVIEW_MAX_CAPABILITY_BYTES = 1_048_576;
export const PROMPT_PREVIEW_MAX_REQUEST_BYTES = 262_144;
export const PROMPT_PREVIEW_MAX_DEPTH = 32;
export const PROMPT_PREVIEW_MAX_NODES = 10_000;
export const PROMPT_PREVIEW_MAX_KEYS = 5_000;
export const PROMPT_PREVIEW_MAX_KEY_BYTES = 256;
export const PROMPT_PREVIEW_MAX_STRING_BYTES = 65_536;
export const PROMPT_PREVIEW_MAX_VALUE_WEIGHT = 131_072;
export const PROMPT_PREVIEW_MAX_STRING_AGGREGATE_BYTES = 1_048_576;
export const PROMPT_PREVIEW_MAX_SEGMENTS = 10_000;
export const PROMPT_PREVIEW_MAX_RESULT_BYTES = 2_097_152;

const utf8 = new TextEncoder();

/** Return the exact UTF-8 byte length of one JavaScript string. */
export function utf8Bytes(value: string): number {
  return utf8.encode(value).byteLength;
}

/** Return compact JSON and its exact UTF-8 size. */
export function compactJson(value: unknown): {
  readonly json: string;
  readonly bytes: number;
} {
  const json = JSON.stringify(value);
  if (json === undefined) {
    throw new TypeError("Value is not JSON serializable.");
  }
  return { json, bytes: utf8Bytes(json) };
}
