/**
 * Strict runtime validation for persisted tool-approval replay state.
 *
 * @internal
 * @module
 */

import type {
  ToolApprovalReplayProvenance,
} from "../types";

type CommittedToolApprovalReplayProvenance = Extract<
  ToolApprovalReplayProvenance,
  { readonly version: 2 }
>;

const V2_KEYS = [
  "attempt",
  "commitment",
  "identityEpoch",
  "namespace",
  "policies",
  "requestArtifactId",
  "requestEvidence",
  "requestProducer",
  "tool",
  "version",
] as const;

/** Validate the exact closed V2 continuation before exposing lifecycle refs. */
export function isCommittedToolApprovalReplayProvenance(
  value: unknown,
): value is CommittedToolApprovalReplayProvenance {
  if (!hasExactKeys(value, V2_KEYS) || value.version !== 2) return false;
  if (
    value.identityEpoch !== 1 ||
    !validNamespace(value.namespace) ||
    !validExecutionRef(value.attempt) ||
    !validExecutionRef(value.requestProducer) ||
    value.attempt.runId !== value.namespace.runId ||
    typeof value.requestArtifactId !== "string" ||
    !/^artifact_[0-9a-f]{64}$/u.test(value.requestArtifactId) ||
    !validRequestEvidence(value.requestEvidence, value.attempt.spanId) ||
    !isJsonValue(value.tool) ||
    !Array.isArray(value.policies) ||
    typeof value.commitment !== "string" ||
    !/^[0-9a-f]{64}$/u.test(value.commitment)
  ) {
    return false;
  }
  return value.policies.every(validPolicyIdentity);
}

function validNamespace(value: unknown): value is {
  readonly operationId: string;
  readonly runId: string;
} {
  return (
    hasExactKeys(value, ["operationId", "runId"]) &&
    validRunId(value.operationId) &&
    validRunId(value.runId)
  );
}

function validExecutionRef(value: unknown): value is {
  readonly runId: string;
  readonly traceId: string;
  readonly spanId: string;
} {
  return (
    hasExactKeys(value, ["runId", "spanId", "traceId"]) &&
    validRunId(value.runId) &&
    typeof value.traceId === "string" &&
    /^[0-9a-f]{32}$/u.test(value.traceId) &&
    !/^0+$/u.test(value.traceId) &&
    typeof value.spanId === "string" &&
    /^[0-9a-f]{16}$/u.test(value.spanId) &&
    !/^0+$/u.test(value.spanId)
  );
}

function validRequestEvidence(value: unknown, spanId: string): boolean {
  return (
    hasExactKeys(value, [
      "evidenceKind",
      "id",
      "kind",
      "recordedAt",
      "role",
      "subject",
    ]) &&
    value.kind === "execution.evidence" &&
    typeof value.id === "string" &&
    /^evidence_[0-9a-f]{16,64}$/u.test(value.id) &&
    hasExactKeys(value.subject, ["id", "kind"]) &&
    value.subject.kind === "execution" &&
    value.subject.id === spanId &&
    value.role === "authority" &&
    value.evidenceKind === "approval.request" &&
    typeof value.recordedAt === "string" &&
    !Number.isNaN(Date.parse(value.recordedAt))
  );
}

function validPolicyIdentity(value: unknown): boolean {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "approvalMiddleware" || value.kind === "toolPolicy") {
    return (
      hasExactKeys(value, ["id", "kind"]) &&
      typeof value.id === "string" &&
      value.id.length > 0
    );
  }
  return (
    value.kind === "declaration" &&
    hasOnlyKeys(value, [
      "key",
      "kind",
      "layer",
      "owner",
      "policyKind",
    ]) &&
    typeof value.key === "string" &&
    value.key.length > 0 &&
    ["call", "prompt", "context"].includes(String(value.layer)) &&
    ["always", "function"].includes(String(value.policyKind)) &&
    (value.owner === undefined || typeof value.owner === "string")
  );
}

function isJsonValue(value: unknown): boolean {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return (
    isRecord(value) &&
    Object.values(value).every(
      (entry) => entry !== undefined && isJsonValue(entry),
    )
  );
}

function validRunId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function hasExactKeys<const K extends string>(
  value: unknown,
  keys: readonly K[],
): value is Readonly<Record<K, unknown>> {
  return (
    isRecord(value) &&
    Object.keys(value).length === keys.length &&
    hasOnlyKeys(value, keys)
  );
}

function hasOnlyKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
