/**
 * Canonical fingerprint of a constraint's selected occurrence subject (RFC #173).
 *
 * Settlement suppression is occurrence- and value-specific: a stream-settled occurrence
 * may suppress its terminal re-check only when the terminal subject is the **same
 * canonical JSON value** as the subject that was evaluated. Both the streaming gate and
 * the terminal runner fingerprint the SAME canonical `z.input` subject with this
 * function, so a rewrite that changes the selected subject invalidates its settlement
 * while a rewrite of an unrelated path preserves it.
 *
 * @module
 */

import { sha256Hex } from "../../content/sha256";

const encoder = new TextEncoder();

/**
 * Deterministic JSON of a canonical value under JSON value semantics.
 *
 * @remarks
 * Object-key order is NOT significant (keys are sorted) and `-0` is the same number as
 * `0`, because both are the same JSON value. Array order IS significant. A policy that
 * needs lexical JSON distinctions must select `model.output.text` rather than an
 * object/path boundary, which observes values rather than bytes.
 *
 * Subjects are always canonical `z.input` decoded from provider JSON, so only JSON value
 * types reach this function; `Date`/`Map`/`Set`/class instances cannot occur.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    // `Object.is(-0, 0)` is false, so normalize the negative zero JSON aliases.
    if (typeof value === "number" && Object.is(value, -0)) return "0";
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

/**
 * A content-free SHA-256 fingerprint of one canonical occurrence subject.
 *
 * @remarks
 * This is security evidence: a collision silently SUPPRESSES a constraint re-check, so a
 * non-cryptographic digest is not adequate no matter how wide. It is a digest rather than
 * the canonical string itself because settlement records travel with seals and audit, and
 * the subject is model output that must never be carried there.
 */
export function subjectFingerprint(subject: unknown): string {
  return sha256Hex(encoder.encode(canonicalJson(subject)));
}
