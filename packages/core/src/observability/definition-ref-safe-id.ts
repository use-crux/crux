/**
 * Canonical definition-id normalization for runtime evidence.
 *
 * A {@link import('./contract').DefinitionRef} joins a runtime record back to a
 * Project Index definition, so the id it carries must equal the indexer's
 * `ProjectDefinition.ID` byte-for-byte. This module ports the indexer's
 * `safe_id` normalization and its empty-input fingerprint fallback to an
 * edge-runtime-safe, dependency-free implementation. If these ever drift from
 * the indexer, the runtime→index join silently breaks.
 *
 * @module
 */

import { sha256Hex } from '../content/sha256'

/**
 * Port of the indexer's `safe_id` normalization (see
 * `crates/primitives/src/definition.rs` and
 * `packages/indexer/src/indexer/definitions.ts`). Keeps `[A-Za-z0-9_.:-]`,
 * collapses any other run into a single `-`, and trims leading/trailing `-`.
 * The canonical definition id emitted here must equal the indexer's, or the
 * runtime→index join silently breaks.
 */
export function safeDefinitionId(value: string): string {
  // `id` is a required non-empty string in public types, but tolerate loose
  // internal callers rather than throwing on the observability path.
  const raw = typeof value === 'string' ? value : String(value)
  let output = ''
  let pendingDash = false
  for (const character of raw.trim()) {
    if (/[A-Za-z0-9_.:-]/.test(character)) {
      if (pendingDash && !output.endsWith('-')) output += '-'
      output += character
      pendingDash = false
    } else {
      pendingDash = true
    }
  }
  const trimmed = output.replace(/^-+|-+$/g, '')
  // Empty-after-sanitize (all-punctuation/unicode/whitespace authored ids): mirror
  // the indexer's fingerprint fallback exactly — sha256(JSON.stringify(value))
  // truncated to 16 hex chars over the *original untrimmed* value — so the
  // runtime→index join stays byte-identical instead of fabricating a raw id.
  return trimmed || fingerprintDefinitionId(raw)
}

/**
 * Edge-runtime-safe port of the indexer's `fingerprint` (see
 * `packages/indexer/src/indexer/definitions.ts` and the Rust `fingerprint_json`
 * in `crates/primitives/src/definition.rs`). Uses the pure-TS SHA-256 and
 * `JSON.stringify`, whose string escaping matches `serde_json::to_string`, so no
 * `node:crypto` dependency is introduced.
 */
export function fingerprintDefinitionId(value: string): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  return sha256Hex(bytes).slice(0, 16)
}
