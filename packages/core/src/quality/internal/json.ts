/**
 * Canonical JSON + identity helpers for the Quality engine.
 *
 * Case identity, config fingerprints, and cassette keys all hash canonical
 * JSON — object keys sorted recursively and non-plain identity values tagged
 * so semantically equal values produce byte-equal strings.
 *
 * @internal Not exported from `@use-crux/core/quality` — engine plumbing only.
 * @module
 */

import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json";
export { canonicalJson } from "./canonical-json";

/**
 * SHA-256 hex digest of a string.
 *
 * @internal
 */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Derive the stable case id from a case's content: the first 12 hex chars of
 * the SHA-256 of the canonical JSON of its identity payload (spec 01 §3).
 *
 * @internal
 */
export function contentCaseId(identity: unknown): string {
  return sha256Hex(canonicalJson(identity)).slice(0, 12);
}

/**
 * Slugify an explicit case name for use as a case id: lowercase, runs of
 * non-alphanumerics collapsed to `-`, trimmed.
 *
 * @internal
 */
export function slugifyCaseName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
