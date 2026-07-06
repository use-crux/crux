/**
 * Redaction and size control for persisted Quality records.
 *
 * Cell snapshots (`input`/`output`/`expected`/previews) pass through the
 * project redaction config before persistence (spec 02 §1). Redaction is
 * dot-path based with always-on defaults for authorization headers and API
 * keys; output snapshots are truncated at 32 KiB — full outputs live in the
 * trace store, reachable via `traceIds`.
 *
 * @internal Not exported from `@use-crux/core/quality` — engine plumbing only.
 * @module
 */

import { canonicalJson } from './json'
import {
  REDACTED,
  SENSITIVE_KEY_PATTERN,
  redactSensitiveValue,
} from '../../shared/redaction'

/** Per-cell output snapshot size limit in bytes (spec 02 §1). @internal */
export const OUTPUT_TRUNCATION_LIMIT = 32 * 1024

/** Truncation marker appended to oversized snapshots. @internal */
export const TRUNCATION_MARKER = '…[truncated]'

/**
 * Feedback payload roots accepted by `quality.redact` root-qualified paths.
 *
 * Evaluation cell snapshots use value-relative paths such as `customer.email`.
 * Feedback records contain multiple named payloads, so their configured paths
 * are root-qualified: `metadata.customer.email`, `expected.answer`, or
 * `proposal.statement`.
 *
 * @internal
 */
export type QualityRedactionRoot = 'metadata' | 'expected' | 'proposal'

/**
 * Always-on redaction: key names that are redacted at every depth regardless
 * of configuration — authorization headers and API keys (spec 01 §9).
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function redactNode(value: unknown, paths: ReadonlyArray<readonly string[]>): unknown {
  if (Array.isArray(value)) {
    // Arrays are transparent to dot-paths: the same segments apply per item.
    return value.map((item) => redactNode(item, paths))
  }
  if (!isRecord(value)) return value
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      out[key] = REDACTED
      continue
    }
    const matching = paths.filter((path) => path[0] === key)
    if (matching.some((path) => path.length === 1)) {
      out[key] = REDACTED
      continue
    }
    const remaining = matching.map((path) => path.slice(1))
    out[key] = remaining.length > 0 ? redactNode(entry, remaining) : redactNode(entry, [])
  }
  return out
}

/**
 * Apply dot-path redaction plus the always-on defaults to a value snapshot.
 * Pure — returns a new structure, never mutates the input.
 *
 * @param value - The snapshot to redact.
 * @param paths - Configured dot-paths (e.g. `['user.email']`). Arrays are
 *                transparent: `items.secret` redacts `secret` in every item.
 *
 * @internal
 */
export function applyRedaction(value: unknown, paths: readonly string[]): unknown {
  const split = paths.map((path) => path.split('.').filter((segment) => segment !== ''))
  return redactNode(redactSensitiveValue(value), split)
}

/**
 * Apply root-qualified `quality.redact` paths to a named feedback payload.
 *
 * Always-on authorization/API-key redaction still applies to every nested key.
 * Configured paths are scoped by the first segment: `metadata.customer.email`
 * becomes `customer.email` when redacting the `metadata` payload and is ignored
 * for the `expected` or `proposal` payloads.
 *
 * @internal
 */
export function applyRootRedaction<TValue>(
  value: TValue,
  root: QualityRedactionRoot,
  paths: readonly string[],
): TValue {
  const scopedPaths = paths.flatMap((path) => {
    const [head, ...tail] = path.split('.').filter((segment) => segment !== '')
    return head === root && tail.length > 0 ? [tail.join('.')] : []
  })
  return applyRedaction(value, scopedPaths) as TValue
}

/**
 * Enforce the 32 KiB output-snapshot limit. Oversized strings are cut with
 * the truncation marker; oversized structured values are replaced by their
 * truncated canonical-JSON rendering. The boolean drives the cell's
 * `metadata.truncated` flag.
 *
 * @internal
 */
export function truncateOutput(value: unknown): { value: unknown; truncated: boolean } {
  if (typeof value === 'string') {
    if (Buffer.byteLength(value, 'utf8') <= OUTPUT_TRUNCATION_LIMIT) return { value, truncated: false }
    return { value: cutToLimit(value) + TRUNCATION_MARKER, truncated: true }
  }
  const rendered = canonicalJson(value)
  if (Buffer.byteLength(rendered, 'utf8') <= OUTPUT_TRUNCATION_LIMIT) return { value, truncated: false }
  return { value: cutToLimit(rendered) + TRUNCATION_MARKER, truncated: true }
}

function cutToLimit(text: string): string {
  let cut = text.slice(0, OUTPUT_TRUNCATION_LIMIT)
  while (Buffer.byteLength(cut, 'utf8') > OUTPUT_TRUNCATION_LIMIT) {
    cut = cut.slice(0, -1024)
  }
  return cut
}
