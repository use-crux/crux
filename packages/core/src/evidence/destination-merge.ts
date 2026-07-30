/**
 * Conservative local and readable-destination evidence overlay.
 *
 * @internal
 * @module
 */

import {
  EVIDENCE_ROLES,
  type EvidenceRole,
} from "./roles";
import type { EvidenceDestinationInspectResult } from "./destination";
import { evidenceIdempotencyConflictError } from "./errors";
import {
  createEvidenceRolesView,
  type EvidenceReadModelOptions,
  type EvidenceReadSnapshot,
} from "./read-model";
import type { EvidenceRecord } from "./record-types";
import type {
  EvidenceExplicitCoverageStatus,
  EvidenceRolesView,
  EvidenceRoleStatus,
  EvidenceRoleView,
} from "./view-types";
import { evidenceSubjectKey } from "./subjects";
import { hydrateEquivalentRelationship } from "./destination-hydration";

/** Merge captured sources into one frozen five-role projection. @internal */
export function mergeEvidenceSources(
  local: EvidenceReadSnapshot | undefined,
  destination: EvidenceDestinationInspectResult | undefined,
  options: EvidenceReadModelOptions,
): EvidenceRolesView {
  const destinationSnapshot = destination
    ? snapshotFromDestination(destination)
    : undefined;
  const snapshot = mergeSnapshots(local, destinationSnapshot);
  const roles = createEvidenceRolesView(snapshot, options);
  return destination
    ? applyDestinationAggregates(roles, destination, options, local)
    : roles;
}

function snapshotFromDestination(
  result: EvidenceDestinationInspectResult,
): EvidenceReadSnapshot {
  return {
    records: Object.freeze(
      Object.fromEntries(
        EVIDENCE_ROLES.map((role) => [
          role,
          mergeRecords(
            [],
            [
              ...(result.roles[role].history ?? []),
              ...result.roles[role].records,
            ],
          ),
        ]),
      ) as Record<EvidenceRole, readonly EvidenceRecord[]>,
    ),
    historyIds: Object.freeze(
      Object.fromEntries(
        EVIDENCE_ROLES.map((role) => [
          role,
          Object.freeze(
            (result.roles[role].history ?? []).map(({ ref }) => ref.id),
          ),
        ]),
      ) as unknown as Record<EvidenceRole, readonly string[]>,
    ),
    coverage: Object.freeze(
      Object.fromEntries(
        EVIDENCE_ROLES.map((role) => [
          role,
          result.roles[role].coverage
            ? Object.freeze([{ status: result.roles[role].coverage }])
            : Object.freeze([]),
        ]),
      ) as Record<
        EvidenceRole,
        readonly { readonly status: EvidenceExplicitCoverageStatus }[]
      >,
    ),
    truncated: Object.freeze(
      Object.fromEntries(
        EVIDENCE_ROLES.map((role) => [
          role,
          result.roles[role].truncated,
        ]),
      ) as Record<EvidenceRole, boolean>,
    ),
  };
}

function mergeSnapshots(
  local: EvidenceReadSnapshot | undefined,
  destination: EvidenceReadSnapshot | undefined,
): EvidenceReadSnapshot {
  if (!local && destination) return destination;
  if (local && !destination) return local;
  if (!local || !destination) {
    throw new TypeError("At least one evidence source is required.");
  }

  return {
    records: Object.freeze(
      Object.fromEntries(
        EVIDENCE_ROLES.map((role) => [
          role,
          mergeRecords(
            destination.records[role],
            local.records[role],
          ),
        ]),
      ) as Record<EvidenceRole, readonly EvidenceRecord[]>,
    ),
    historyIds: Object.freeze(
      Object.fromEntries(
        EVIDENCE_ROLES.map((role) => [
          role,
          Object.freeze([
            ...(destination.historyIds?.[role] ?? []),
            ...(local.historyIds?.[role] ?? []),
          ]),
        ]),
      ) as unknown as Record<EvidenceRole, readonly string[]>,
    ),
    coverage: Object.freeze(
      Object.fromEntries(
        EVIDENCE_ROLES.map((role) => [
          role,
          Object.freeze([
            ...(destination.coverage?.[role] ?? []),
            ...(local.coverage?.[role] ?? []),
          ]),
        ]),
      ) as Record<
        EvidenceRole,
        readonly { readonly status: EvidenceExplicitCoverageStatus }[]
      >,
    ),
    truncated: Object.freeze(
      Object.fromEntries(
        EVIDENCE_ROLES.map((role) => [
          role,
          destination.truncated[role] || local.truncated[role],
        ]),
      ) as Record<EvidenceRole, boolean>,
    ),
    ...(local.version !== undefined ? { version: local.version } : {}),
  };
}

function mergeRecords(
  durable: readonly EvidenceRecord[],
  overlay: readonly EvidenceRecord[],
): readonly EvidenceRecord[] {
  const merged = [...durable];
  const byId = new Map(merged.map((record) => [record.ref.id, record]));
  for (const local of overlay) {
    const existing = byId.get(local.ref.id);
    if (!existing) {
      merged.push(local);
      byId.set(local.ref.id, local);
      continue;
    }
    if (!sameRelationship(existing, local)) {
      throw evidenceIdempotencyConflictError();
    }
    const hydrated = hydrateEquivalentRelationship(existing, local);
    if (hydrated !== existing) {
      merged[merged.indexOf(existing)] = hydrated;
      byId.set(local.ref.id, hydrated);
    }
  }
  return Object.freeze(merged);
}

function sameRelationship(
  left: EvidenceRecord,
  right: EvidenceRecord,
): boolean {
  return (
    left.ref.role === right.ref.role &&
    left.ref.evidenceKind === right.ref.evidenceKind &&
    left.ref.recordedAt === right.ref.recordedAt &&
    evidenceSubjectKey(left.ref.subject) ===
      evidenceSubjectKey(right.ref.subject) &&
    evidenceSubjectKey(left.source) === evidenceSubjectKey(right.source) &&
    left.conclusion === right.conclusion &&
    left.observedAt === right.observedAt &&
    (left.producer === undefined ||
      right.producer === undefined ||
      producerKey(left) === producerKey(right)) &&
    left.supersedes.map(({ id }) => id).join("\0") ===
      right.supersedes.map(({ id }) => id).join("\0")
  );
}

function producerKey(record: EvidenceRecord): string {
  return record.producer === undefined
    ? ""
    : evidenceSubjectKey(record.producer);
}

function applyDestinationAggregates(
  roles: EvidenceRolesView,
  destination: EvidenceDestinationInspectResult,
  options: EvidenceReadModelOptions,
  local: EvidenceReadSnapshot | undefined,
): EvidenceRolesView {
  const localRoles = local
    ? createEvidenceRolesView(local, {
        ...options,
        role: undefined,
        offset: 0,
        limit: 50,
        cursorForNextPage: undefined,
      })
    : undefined;
  return Object.freeze(
    Object.fromEntries(
      EVIDENCE_ROLES.map((role) => [
        role,
        applyDestinationRole(
          roles[role],
          destination.roles[role],
          localRoles?.[role],
          options.role,
        ),
      ]),
    ) as unknown as EvidenceRolesView,
  );
}

function applyDestinationRole<R extends EvidenceRole>(
  base: EvidenceRoleView<R>,
  durable: EvidenceDestinationInspectResult["roles"][R],
  local: EvidenceRoleView<R> | undefined,
  selectedRole: EvidenceRole | undefined,
): EvidenceRoleView<R> {
  const { conclusion: _baseConclusion, ...baseWithoutConclusion } = base;
  const authoritativeSummary =
    durable.truncated || (selectedRole !== undefined && selectedRole !== base.role);
  const distinct =
    durable.conclusion !== undefined &&
    local?.conclusion !== undefined &&
    durable.conclusion !== local.conclusion;
  const conflicting =
    durable.conflicting || base.conflicting || distinct;
  const conclusion = conflicting
    ? undefined
    : durable.conclusion ??
      (authoritativeSummary ? undefined : base.conclusion);
  const status = mergedStatus(durable.status, local?.status);

  return Object.freeze({
    ...baseWithoutConclusion,
    status,
    ...(conclusion !== undefined ? { conclusion } : {}),
    conflicting,
    truncated: base.truncated || durable.truncated,
    ...(durable.cursor !== undefined ? { cursor: durable.cursor } : {}),
  }) as EvidenceRoleView<R>;
}

function mergedStatus<R extends EvidenceRole>(
  durable: EvidenceDestinationInspectResult["roles"][R]["status"],
  local: EvidenceRoleStatus | undefined,
): EvidenceRoleStatus {
  if (local === "present" || durable === "present") return "present";
  return restrictiveStatus([durable, local]);
}

function restrictiveStatus(
  statuses: readonly (EvidenceRoleStatus | undefined)[],
): EvidenceRoleStatus {
  for (const status of [
    "redacted",
    "not-captured",
    "not-configured",
    "not-applicable",
  ] as const) {
    if (statuses.includes(status)) return status;
  }
  return "not-yet-recorded";
}
