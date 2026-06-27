/**
 * Canonical JSON + identity helpers for the Quality engine.
 *
 * Case identity, config fingerprints, and cassette keys all hash canonical
 * JSON — object keys sorted recursively so semantically equal values produce
 * byte-equal strings.
 *
 * @internal Not exported from `@use-crux/core/quality` — engine plumbing only.
 * @module
 */

import { createHash } from 'node:crypto'

/**
 * Serialize a value to canonical JSON: object keys sorted recursively,
 * arrays preserved in order, JSON semantics otherwise (`undefined` object
 * properties dropped; `undefined`/functions in array positions become `null`).
 *
 * @internal
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value)) ?? 'null'
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sortValue(item))
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) {
      const entry = record[key]
      if (entry !== undefined) sorted[key] = sortValue(entry)
    }
    return sorted
  }
  return value
}

/**
 * SHA-256 hex digest of a string.
 *
 * @internal
 */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

/**
 * Derive the stable case id from a case's content: the first 12 hex chars of
 * the SHA-256 of the canonical JSON of its identity payload (spec 01 §3).
 *
 * @internal
 */
export function contentCaseId(identity: unknown): string {
  return sha256Hex(canonicalJson(identity)).slice(0, 12)
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
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
