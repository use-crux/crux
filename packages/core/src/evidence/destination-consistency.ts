/**
 * Cross-row and complete-aggregate destination consistency checks.
 *
 * @internal
 * @module
 */

import type {
  EvidenceDestinationInspectRequest,
  EvidenceDestinationInspectResult,
} from "./destination";
import {
  evidenceIdempotencyConflictError,
  evidenceInputInvalidError,
} from "./errors";
import { EVIDENCE_ROLES, type EvidenceRole } from "./roles";
import type { EvidenceRecord } from "./record-types";
import { canonicalEvidenceJson } from "./canonical-json";
import type {
  EvidenceExplicitCoverageStatus,
  EvidenceRoleStatus,
} from "./view-types";

/** Reject divergent duplicate identities and dishonest complete aggregates. */
export function validateDestinationConsistency(
  roles: EvidenceDestinationInspectResult["roles"],
  request: EvidenceDestinationInspectRequest,
): void {
  const fingerprints = new Map<string, string>();
  for (const role of EVIDENCE_ROLES) {
    const result = roles[role];
    for (const record of [...result.records, ...(result.history ?? [])]) {
      const fingerprint = relationshipFingerprint(record);
      const previous = fingerprints.get(record.ref.id);
      if (previous !== undefined && previous !== fingerprint) {
        throw evidenceIdempotencyConflictError();
      }
      fingerprints.set(record.ref.id, fingerprint);
    }
    validateRoleSummary(role, result, request);
    const hydrated =
      request.role === undefined || request.role === role;
    if (!hydrated || result.truncated || request.cursor !== undefined) {
      continue;
    }
    const conclusions = new Set(
      result.records.flatMap((record) =>
        record.conclusion === undefined ? [] : [record.conclusion],
      ),
    );
    const conflicting = conclusions.size > 1;
    const conclusion =
      conclusions.size === 1 ? [...conclusions][0] : undefined;
    if (
      result.conflicting !== conflicting ||
      result.conclusion !== conclusion
    ) {
      throw evidenceInputInvalidError(
        `The readable evidence destination returned an invalid result. The complete ${role} aggregate contradicts its hydrated records.`,
        "Fix the configured destination so complete aggregates match their hydrated evidence rows.",
      );
    }
    if (uniqueActiveRecordCount(result.records) !== result.activeRecordCount) {
      throw invalidAggregate(
        role,
        "active record count contradicts its complete hydrated records",
      );
    }
    const completeStatus = statusFromCompleteRows(
      result.records,
      result.coverage,
    );
    if (result.status !== completeStatus) {
      throw invalidAggregate(
        role,
        "status contradicts its complete hydrated records",
      );
    }
  }
}

function validateRoleSummary<R extends EvidenceRole>(
  role: R,
  result: EvidenceDestinationInspectResult["roles"][R],
  request: EvidenceDestinationInspectRequest,
): void {
  if (result.conflicting && result.conclusion !== undefined) {
    throw invalidAggregate(role, "conflict also declares a conclusion");
  }
  if (result.activeRecordCount < 2 && result.conflicting) {
    throw invalidAggregate(role, "declares a conflict with fewer than two active records");
  }
  if (uniqueActiveRecordCount(result.records) > result.activeRecordCount) {
    throw invalidAggregate(role, "returns more active records than its complete count");
  }
  if (
    role === "intent" &&
    (result.conflicting || result.conclusion !== undefined)
  ) {
    throw invalidAggregate(role, "intent declares a conclusion conflict");
  }
  if (result.cursor !== undefined && !result.truncated) {
    throw invalidAggregate(role, "cursor is attached to a complete result");
  }
  if (result.coverage !== undefined) {
    if (
      result.coverage !== result.status ||
      result.records.length > 0 ||
      result.conclusion !== undefined ||
      result.conflicting
    ) {
      throw invalidAggregate(role, "explicit coverage contradicts active evidence");
    }
  } else if (
    result.status === "not-configured" ||
    result.status === "not-applicable"
  ) {
    throw invalidAggregate(role, "explicit status has no matching coverage fact");
  }
  if (
    (result.status === "present" ||
      result.status === "not-yet-recorded") &&
    result.coverage !== undefined
  ) {
    throw invalidAggregate(role, "coverage is present for a derived status");
  }

  const selected = request.role === undefined || request.role === role;
  if (!selected || result.truncated) {
    validateReturnedRowsLowerBound(role, result.status, result.records);
    validateReturnedConclusionLowerBound(role, result);
  }
}

function uniqueActiveRecordCount(
  records: readonly EvidenceRecord[],
): number {
  return new Set(records.map(({ ref }) => ref.id)).size;
}

function validateReturnedRowsLowerBound(
  role: EvidenceRole,
  status: EvidenceRoleStatus,
  records: readonly EvidenceRecord[],
): void {
  const lowerBound = statusFromPartialRows(records);
  const allowed = compatibleSummaryStatuses(lowerBound);
  if (!allowed.includes(status)) {
    throw invalidAggregate(
      role,
      "status contradicts its returned active records",
    );
  }
}

function validateReturnedConclusionLowerBound<R extends EvidenceRole>(
  role: R,
  result: EvidenceDestinationInspectResult["roles"][R],
): void {
  const visible = new Set(
    result.records.flatMap(({ conclusion }) =>
      conclusion === undefined ? [] : [conclusion],
    ),
  );
  if (visible.size > 1 && !result.conflicting) {
    throw invalidAggregate(
      role,
      "conflict summary contradicts its returned active records",
    );
  }
  if (
    visible.size === 1 &&
    !result.conflicting &&
    result.conclusion !== [...visible][0]
  ) {
    throw invalidAggregate(
      role,
      "conclusion contradicts its returned active records",
    );
  }
}

function statusFromCompleteRows(
  records: readonly EvidenceRecord[],
  coverage: EvidenceExplicitCoverageStatus | undefined,
): EvidenceRoleStatus {
  const active = statusFromPartialRows(records);
  if (active !== undefined) return active;
  return coverage ?? "not-yet-recorded";
}

function statusFromPartialRows(
  records: readonly EvidenceRecord[],
): EvidenceRoleStatus | undefined {
  const states = records.map(({ payloadState }) => payloadState);
  if (states.some((state) => state === "available" || state === "reference")) {
    return "present";
  }
  if (states.includes("redacted")) return "redacted";
  if (states.includes("not-captured")) return "not-captured";
  return undefined;
}

function compatibleSummaryStatuses(
  lowerBound: EvidenceRoleStatus | undefined,
): readonly EvidenceRoleStatus[] {
  switch (lowerBound) {
    case "present":
      return ["present"];
    case "redacted":
      return ["present", "redacted"];
    case "not-captured":
      return ["present", "redacted", "not-captured"];
    default:
      return [
        "present",
        "redacted",
        "not-captured",
        "not-configured",
        "not-applicable",
        "not-yet-recorded",
      ];
  }
}

function invalidAggregate(role: EvidenceRole, why: string) {
  return evidenceInputInvalidError(
    `The readable evidence destination returned an invalid result. The ${role} aggregate ${why}.`,
    "Fix the configured destination so complete aggregates match their hydrated evidence rows.",
  );
}

function relationshipFingerprint(record: EvidenceRecord): string {
  return canonicalEvidenceJson({
    ref: record.ref,
    source: record.source,
    conclusion: record.conclusion,
    observedAt: record.observedAt,
    supersedes: record.supersedes,
    producer: record.producer,
  });
}
