/**
 * Pure active/history, coverage, and conflict projection for evidence views.
 *
 * @internal
 * @module
 */

import {
  EVIDENCE_ROLES,
  type EvidenceConclusion,
  type EvidenceRole,
} from "./roles";
import type { EvidenceRecord } from "./record-types";
import type {
  EvidenceExplicitCoverageStatus,
  EvidenceInspectOptions,
  EvidenceRolesView,
  EvidenceRoleStatus,
  EvidenceRoleView,
} from "./view-types";

/** Immutable source snapshot consumed by the evidence read model. @internal */
export interface EvidenceReadSnapshot {
  readonly records: Readonly<Record<EvidenceRole, readonly EvidenceRecord[]>>;
  /** Destination-classified history that may lack an on-page successor. */
  readonly historyIds?: Readonly<Record<EvidenceRole, readonly string[]>>;
  readonly truncated: Readonly<Record<EvidenceRole, boolean>>;
  readonly coverage?: Readonly<
    Record<
      EvidenceRole,
      readonly { readonly status: EvidenceExplicitCoverageStatus }[]
    >
  >;
  readonly version?: number;
}

/** Normalized hydration options consumed by the read model. @internal */
export interface EvidenceReadModelOptions
  extends Readonly<EvidenceInspectOptions> {
  readonly limit: number;
  readonly offset: number;
  readonly cursorForNextPage?: (offset: number) => string;
}

/** Project a frozen five-role read model from one immutable snapshot. @internal */
export function createEvidenceRolesView(
  snapshot: EvidenceReadSnapshot,
  options: EvidenceReadModelOptions,
): EvidenceRolesView {
  return Object.freeze(
    Object.fromEntries(
      EVIDENCE_ROLES.map((role) => [
        role,
        createRoleView(
          role,
          snapshot.records[role],
          snapshot.historyIds?.[role] ?? [],
          snapshot.truncated[role],
          snapshot.coverage?.[role] ?? [],
          options,
        ),
      ]),
    ) as unknown as EvidenceRolesView,
  );
}

function createRoleView<R extends EvidenceRole>(
  role: R,
  inputRecords: readonly EvidenceRecord[],
  explicitHistoryIds: readonly string[],
  truncated: boolean,
  coverage: readonly { readonly status: EvidenceExplicitCoverageStatus }[],
  options: EvidenceReadModelOptions,
): EvidenceRoleView<R> {
  const supersededIds = new Set(
    [
      ...explicitHistoryIds,
      ...inputRecords.flatMap((record) =>
        record.supersedes.map(({ id }) => id),
      ),
    ],
  );
  const active = inputRecords.filter(
    (record) => !supersededIds.has(record.ref.id),
  );
  const history = inputRecords.filter((record) =>
    supersededIds.has(record.ref.id),
  );
  const hydrated =
    options.role === undefined || options.role === role;
  const records = (hydrated
    ? projectRecords(
        active.slice(options.offset, options.offset + options.limit),
        options.includeData === true,
      )
    : Object.freeze([])) as readonly EvidenceRecord<R>[];
  const conclusions = new Set(
    active.flatMap((record) =>
      record.conclusion === undefined ? [] : [record.conclusion],
    ),
  );
  const conclusion =
    conclusions.size === 1
      ? ([...conclusions][0] as EvidenceConclusion<R>)
      : undefined;
  const historyPage =
    hydrated && options.includeHistory === true
      ? projectRecords(
          history.slice(options.offset, options.offset + options.limit),
          options.includeData === true,
        )
      : undefined;
  const hasMore =
    hydrated &&
    (active.length > options.offset + options.limit ||
      (options.includeHistory === true &&
        history.length > options.offset + options.limit));
  const cursor =
    options.role === role && hasMore
      ? options.cursorForNextPage?.(options.offset + options.limit)
      : undefined;

  return Object.freeze({
    role,
    status: coverageStatus(active, coverage),
    records,
    ...(historyPage !== undefined
      ? {
          history: historyPage as readonly EvidenceRecord<R>[],
        }
      : {}),
    ...(conclusion !== undefined ? { conclusion } : {}),
    conflicting: conclusions.size > 1,
    truncated: truncated || hasMore,
    ...(cursor !== undefined ? { cursor } : {}),
  });
}

function coverageStatus(
  active: readonly EvidenceRecord[],
  facts: readonly { readonly status: EvidenceExplicitCoverageStatus }[],
): EvidenceRoleStatus {
  if (
    active.some(
      ({ payloadState }) =>
        payloadState === "available" || payloadState === "reference",
    )
  ) {
    return "present";
  }
  if (active.some(({ payloadState }) => payloadState === "redacted")) {
    return "redacted";
  }
  if (active.some(({ payloadState }) => payloadState === "not-captured")) {
    return "not-captured";
  }
  for (const status of [
    "redacted",
    "not-captured",
    "not-configured",
    "not-applicable",
  ] as const) {
    if (facts.some((fact) => fact.status === status)) return status;
  }
  return "not-yet-recorded";
}

function projectRecords(
  records: readonly EvidenceRecord[],
  includeData: boolean,
): readonly EvidenceRecord[] {
  return Object.freeze(
    records.map((record) => {
      if (includeData || record.data === undefined) return record;
      const { data: _data, ...withoutData } = record;
      return Object.freeze(withoutData) as EvidenceRecord;
    }),
  );
}
