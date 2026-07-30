/** Pure presentation projection for Local's canonical evidence read model. */

import type {
  EvidencePayloadState,
  EvidencePayloadUnavailableReason,
  EvidenceRole,
  EvidenceRoleStatus,
} from "@use-crux/core/evidence";
import { evidenceRendererForKind } from "./representation";
import type {
  EvidenceApiRecord,
  EvidenceApiRoleResult,
  EvidenceApiSubject,
} from "./types";

const roleLabels = {
  intent: "Intent",
  authority: "Authority",
  change: "Change",
  verification: "Verification",
  recovery: "Recovery",
} as const satisfies Readonly<Record<EvidenceRole, string>>;

/** Human-readable label for one of the five closed evidence roles. */
export function evidenceRoleLabel(role: EvidenceRole): string {
  return roleLabels[role];
}

export type EvidencePresentationTone =
  | "ok"
  | "muted"
  | "warn"
  | "danger"
  | "crux";

/** User-facing language and non-color-only tone for one complete role status. */
export function evidenceStatusPresentation(status: EvidenceRoleStatus): {
  readonly value: EvidenceRoleStatus;
  readonly label: string;
  readonly tone: EvidencePresentationTone;
} {
  switch (status) {
    case "present":
      return { value: status, label: "Evidence present", tone: "ok" };
    case "not-configured":
      return {
        value: status,
        label: "Native producer not configured",
        tone: "muted",
      };
    case "not-applicable":
      return {
        value: status,
        label: "This role does not apply",
        tone: "muted",
      };
    case "not-captured":
      return {
        value: status,
        label: "Not captured by the producer",
        tone: "warn",
      };
    case "redacted":
      return { value: status, label: "Payload unavailable", tone: "warn" };
    default:
      return {
        value: "not-yet-recorded",
        label: "No evidence recorded yet",
        tone: "muted",
      };
  }
}

/** Exact payload-availability language approved for Run Detail. */
export function evidencePayloadPresentation(
  state: EvidencePayloadState,
  reason?: EvidencePayloadUnavailableReason,
): string {
  if (state === "available") return "Payload available";
  if (state === "reference") return "Payload not retained here";
  if (state === "not-captured") return "Not captured by the producer";
  if (reason === "policy") return "Removed by policy";
  if (reason === "retention") return "Payload expired";
  if (reason === "access") return "Unavailable with this access";
  return "Payload unavailable";
}

/** Project one immutable relationship into a renderer-owned record card. */
export function projectEvidenceRecord<R extends EvidenceRole>(
  record: EvidenceApiRecord<R>,
) {
  const renderer = evidenceRendererForKind(record.ref.evidenceKind);
  const late = record.acceptedAfterTerminal;
  const unavailableNavigation = [
    ...(!record.producer
      ? [
          "Producer navigation is unavailable because its retained identity is not accessible.",
        ]
      : []),
  ];
  return Object.freeze({
    id: record.ref.id,
    role: record.ref.role,
    evidenceKind: record.ref.evidenceKind,
    renderer,
    source: Object.freeze({ ...record.source }) as EvidenceApiSubject,
    ...(record.producer
      ? {
          producer: Object.freeze({ ...record.producer }) as NonNullable<
            EvidenceApiRecord<R>["producer"]
          >,
        }
      : {}),
    ...(record.conclusion ? { conclusion: record.conclusion } : {}),
    payload: Object.freeze({
      state: record.payloadState,
      label: evidencePayloadPresentation(
        record.payloadState,
        record.payloadUnavailableReason,
      ),
      ...(record.data === undefined ? {} : { data: record.data }),
    }),
    supersedes: Object.freeze(record.supersedes.map((item) => item.id)),
    ...(late
      ? {
          acceptedAfterTerminal: Object.freeze({
            label:
              late.judgedAgainst.kind === "run"
                ? "Recorded after this run had ended."
                : "Recorded after this span had ended.",
            tooltip:
              "When Crux Local accepted this evidence relationship, it had already received an explicit end record for this execution.",
            judgedAgainst: Object.freeze({ ...late.judgedAgainst }),
          }),
        }
      : {}),
    unavailableNavigation: Object.freeze(unavailableNavigation),
  });
}

/** Project one complete role aggregate without rederiving destination truth. */
export function projectEvidenceRole<R extends EvidenceRole>(
  role: EvidenceApiRoleResult<R>,
) {
  return Object.freeze({
    role: role.role,
    label: evidenceRoleLabel(role.role),
    status: Object.freeze(evidenceStatusPresentation(role.status)),
    activeRecordCount: role.activeRecordCount,
    ...(role.coverage ? { coverage: role.coverage } : {}),
    ...(role.conclusion ? { conclusion: role.conclusion } : {}),
    conflicting: role.conflicting,
    truncated: role.truncated,
    ...(role.cursor ? { cursor: role.cursor } : {}),
    records: Object.freeze(role.records.map(projectEvidenceRecord)),
    history: Object.freeze((role.history ?? []).map(projectEvidenceRecord)),
  });
}

/**
 * Project only complete destination aggregates for the constant Inspector.
 *
 * @remarks Deliberately ignores hydrated rows because the bounded inspection
 * page cannot establish the role's complete record count.
 */
export function projectEvidenceRoleSummary<R extends EvidenceRole>(
  role: EvidenceApiRoleResult<R>,
) {
  return Object.freeze({
    role: role.role,
    label: evidenceRoleLabel(role.role),
    status: Object.freeze(evidenceStatusPresentation(role.status)),
    activeRecordCount: role.activeRecordCount,
    conflicting: role.conflicting,
  });
}
