/** Web-safe canonical identity for exact Eval evidence reuse. @internal */

import { sha256Hex } from "../../content/sha256";
import { TASK_EVIDENCE_CACHE_EPOCH } from "./evidence/cache-epochs";
import { canonicalFingerprintJson } from "./evidence/canonical-fingerprint";
import type { NormalizedEvalTimeoutPolicy } from "../timeout-policy";

export { TASK_EVIDENCE_CACHE_EPOCH };

export interface TaskEvidenceIdentityInput {
  readonly evalId: string;
  readonly caseId: string;
  readonly input: unknown;
  readonly call?: unknown;
  readonly variant: string;
  readonly trial: number;
  readonly timeout: NormalizedEvalTimeoutPolicy;
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
    taskEvidenceCacheEpoch: TASK_EVIDENCE_CACHE_EPOCH,
    evalId: input.evalId,
    caseId: input.caseId,
    inputFingerprint: fingerprintEvalValue(input.input),
    callFingerprint: fingerprintEvalValue(input.call ?? null),
    variant: input.variant,
    trial: input.trial,
    timeout: input.timeout,
    managedTaskFingerprint: input.managedTaskFingerprint,
    adapterFingerprint: input.adapterFingerprint,
    hostContractFingerprint: input.hostContractFingerprint,
    occurrence: input.occurrence,
  });
  return Object.freeze({ key, fingerprint: key });
}

/** Hash a canonical value without Node Buffer or crypto imports. */
export function fingerprintEvalValue(value: unknown): string {
  return sha256Hex(new TextEncoder().encode(canonicalFingerprintJson(value)));
}

/** Reject values whose bytes cannot participate in a durable exact identity. */
export function isReusableEvalValue(value: unknown): boolean {
  return isReusableValue(value, new WeakSet<object>());
}

function isReusableValue(value: unknown, seen: WeakSet<object>): boolean {
  if (
    typeof value === "function" ||
    typeof value === "symbol" ||
    typeof value === "bigint" ||
    value === undefined ||
    (typeof value === "number" && !Number.isFinite(value))
  )
    return false;
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
    ) &&
    !hasDurableMediaIdentity(value)
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
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  const prototype = Object.getPrototypeOf(value);
  if (
    !Array.isArray(value) &&
    !(value instanceof Map) &&
    !(value instanceof Set) &&
    prototype !== Object.prototype &&
    prototype !== null
  )
    return false;
  return Object.values(value).every((entry) => isReusableValue(entry, seen));
}

function hasDurableMediaIdentity(value: object): boolean {
  const media = value as {
    readonly contentHash?: unknown;
    readonly sha256?: unknown;
    readonly ref?: unknown;
  };
  return [media.contentHash, media.sha256, media.ref].some(
    (entry) => typeof entry === "string" && entry.length > 0,
  );
}
