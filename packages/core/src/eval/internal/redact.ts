/**
 *
 * Redaction and size control for persisted Eval records.
 *
 * Cell snapshots (`input`/`output`/`expected`/previews) pass through the
 * project redaction config before persistence (spec 02 §1). Redaction is
 * dot-path based with always-on defaults for authorization headers and API
 * keys; output snapshots are truncated at 32 KiB — full outputs live in the
 * trace store, reachable via run IDs.
 *
 * @internal Eval engine plumbing only.
 * @module
 */

import { canonicalJson } from "./evidence/canonical-json";
import { fingerprintEvalValue } from "./identity";
import {
  applyRedaction,
  normalizeRedactPaths,
} from "../../shared/redaction";

/** Internal persistence boundary until Crux exposes one shared project policy. */
export interface EvalPersistencePolicy {
  readonly redactPaths: readonly string[];
}

export const DEFAULT_EVAL_PERSISTENCE_POLICY: EvalPersistencePolicy =
  Object.freeze({ redactPaths: Object.freeze([]) });

/** Validate and canonicalize the one data-only project redaction policy. */
export function normalizeEvalPersistencePolicy(
  input: {
    readonly redactPaths?: unknown;
  } = {},
): EvalPersistencePolicy {
  const paths = normalizeRedactPaths(input.redactPaths);
  if (paths.length === 0) return DEFAULT_EVAL_PERSISTENCE_POLICY;
  return Object.freeze({ redactPaths: Object.freeze(paths) });
}

/** Stable, secret-free identity for generated hosts and exact evidence. */
export function fingerprintEvalPersistencePolicy(
  policy: EvalPersistencePolicy,
): string {
  return fingerprintEvalValue({
    schemaVersion: 1,
    redactPaths: policy.redactPaths,
  });
}

/** Per-cell output snapshot size limit in bytes (spec 02 §1). @internal */
export const OUTPUT_TRUNCATION_LIMIT = 32 * 1024;

/** Truncation marker appended to oversized snapshots. @internal */
export const TRUNCATION_MARKER = "…[truncated]";

export { applyRedaction } from "../../shared/redaction";

/**
 * Enforce the 32 KiB output-snapshot limit. Oversized strings are cut with
 * the truncation marker; oversized structured values are replaced by their
 * truncated canonical-JSON rendering. The boolean drives the cell's
 * `metadata.truncated` flag.
 *
 * @internal
 */
export function truncateOutput(value: unknown): {
  value: unknown;
  truncated: boolean;
} {
  if (typeof value === "string") {
    if (byteLength(value) <= OUTPUT_TRUNCATION_LIMIT)
      return { value, truncated: false };
    return { value: cutToLimit(value) + TRUNCATION_MARKER, truncated: true };
  }
  const rendered = canonicalJson(value);
  if (byteLength(rendered) <= OUTPUT_TRUNCATION_LIMIT)
    return { value, truncated: false };
  return { value: cutToLimit(rendered) + TRUNCATION_MARKER, truncated: true };
}

function cutToLimit(text: string): string {
  let cut = text.slice(0, OUTPUT_TRUNCATION_LIMIT);
  while (byteLength(cut) > OUTPUT_TRUNCATION_LIMIT) {
    cut = cut.slice(0, -Math.max(1, Math.ceil(cut.length / 16)));
  }
  return cut;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/** Return a bounded, always-on-redacted snapshot suitable for persistence. */
export function sanitizeEvalSnapshot(
  value: unknown,
  policy: EvalPersistencePolicy = DEFAULT_EVAL_PERSISTENCE_POLICY,
): unknown {
  return truncateOutput(applyRedaction(value, policy.redactPaths)).value;
}

/** Refuse reusable evidence when persistence would alter its semantics. */
export function isEvalSnapshotPersistenceSafe(
  value: unknown,
  policy: EvalPersistencePolicy = DEFAULT_EVAL_PERSISTENCE_POLICY,
): boolean {
  try {
    return (
      canonicalJson(value) ===
      canonicalJson(sanitizeEvalSnapshot(value, policy))
    );
  } catch {
    return false;
  }
}

/** Refuse durable host payloads only when redaction would change semantics. */
export function isEvalSnapshotRedactionSafe(
  value: unknown,
  policy: EvalPersistencePolicy = DEFAULT_EVAL_PERSISTENCE_POLICY,
): boolean {
  try {
    return (
      canonicalJson(value) ===
      canonicalJson(applyRedaction(value, policy.redactPaths))
    );
  } catch {
    return false;
  }
}
