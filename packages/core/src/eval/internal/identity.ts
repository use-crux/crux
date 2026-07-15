/** Web-safe canonical identity for exact Eval evidence reuse. @internal */

import { sha256Hex } from "../../content/sha256";
import { OUTPUT_CACHE_EPOCH } from "../../quality/internal/cache-epochs";
import { canonicalJson } from "../../quality/internal/canonical-json";

export { OUTPUT_CACHE_EPOCH };

export interface TaskEvidenceIdentityInput {
  readonly evalId: string;
  readonly caseId: string;
  readonly input: unknown;
  readonly call?: unknown;
  readonly variant: "current";
  readonly trial: 0;
  readonly managedTaskFingerprint: string;
  readonly adapterFingerprint: string;
  readonly hostContractFingerprint: string;
  readonly occurrence: string;
}

export interface TaskEvidenceIdentity {
  readonly key: string;
  readonly fingerprint: string;
}

/** Build the exact, cross-runtime key for one managed task occurrence. */
export function createTaskEvidenceIdentity(
  input: TaskEvidenceIdentityInput,
): TaskEvidenceIdentity {
  const key = fingerprintEvalValue({
    outputCacheEpoch: OUTPUT_CACHE_EPOCH,
    evalId: input.evalId,
    caseId: input.caseId,
    inputFingerprint: fingerprintEvalValue(input.input),
    callFingerprint: fingerprintEvalValue(input.call ?? null),
    variant: input.variant,
    trial: input.trial,
    managedTaskFingerprint: input.managedTaskFingerprint,
    adapterFingerprint: input.adapterFingerprint,
    hostContractFingerprint: input.hostContractFingerprint,
    occurrence: input.occurrence,
  });
  return Object.freeze({ key, fingerprint: key });
}

/** Hash a canonical value without Node Buffer or crypto imports. */
export function fingerprintEvalValue(value: unknown): string {
  return sha256Hex(new TextEncoder().encode(canonicalJson(value)));
}

/** Reject values whose bytes cannot participate in a durable exact identity. */
export function isReusableEvalValue(value: unknown): boolean {
  return isReusableValue(value, new WeakSet<object>());
}

function isReusableValue(value: unknown, seen: WeakSet<object>): boolean {
  if (typeof value === "function" || typeof value === "symbol") return false;
  if (
    value instanceof Uint8Array ||
    value instanceof ArrayBuffer ||
    value instanceof URL ||
    (typeof Blob !== "undefined" && value instanceof Blob)
  ) {
    return false;
  }
  if (value === null || typeof value !== "object") return true;
  if (seen.has(value)) return false;
  seen.add(value);
  if (
    "type" in value &&
    ["data", "url", "provider-file"].includes(
      String((value as { readonly type?: unknown }).type),
    )
  ) {
    return false;
  }
  if (value instanceof Map) {
    return [...value].every(
      ([key, entry]) =>
        isReusableValue(key, seen) && isReusableValue(entry, seen),
    );
  }
  if (value instanceof Set) {
    return [...value].every((entry) => isReusableValue(entry, seen));
  }
  return Object.values(value).every((entry) => isReusableValue(entry, seen));
}
