/** One-way observed task identity projection for the private result wire. */

import type { EvalTaskHostResult } from "../../eval/internal/types";
import { fingerprintEvalValue } from "../../eval/internal/identity";

const IDENTITY_REASONS = new Set([
  "identity_unavailable",
  "model_identity_unattested",
  "untracked_external_dependency",
  "unresolved_source_dependency",
  "implicit_media",
]);

/** Validate one exact reusable or non-reusable wire identity. */
export function isEvalHostResultIdentity(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.reusable === true) {
    return (
      hasExactKeys(value, ["reusable", "fingerprint"]) &&
      typeof value.fingerprint === "string" &&
      /^[a-f0-9]{64}$/u.test(value.fingerprint)
    );
  }
  return (
    value.reusable === false &&
    hasExactKeys(value, ["reusable", "reason"]) &&
    IDENTITY_REASONS.has(String(value.reason))
  );
}

/** Remove private identity material before an observed result crosses the wire. */
export function projectEvalHostResultIdentity(
  identity: EvalTaskHostResult["observedIdentity"],
): EvalTaskHostResult["observedIdentity"] {
  if (!identity.reusable || "fingerprint" in identity) return identity;
  return Object.freeze({
    reusable: true as const,
    fingerprint: fingerprintEvalValue(identity.fingerprintMaterial),
  });
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length && actual.every((key) => keys.includes(key))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
