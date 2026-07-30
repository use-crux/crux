import type { EvidenceConclusion, EvidenceRole } from "./roles";
import type { EvidenceRecord } from "./record-types";
import type { EvidenceSubject } from "./subjects";

/**
 * Coverage state for one role in an evidence view.
 *
 * @remarks Missing, unconfigured, inapplicable, uncaptured, and redacted
 * evidence remain distinct so an empty row never fabricates certainty.
 */
export type EvidenceRoleStatus =
  | "present"
  | "not-yet-recorded"
  | "not-configured"
  | "not-applicable"
  | "not-captured"
  | "redacted";

/** Explicit non-present status authored by a native producer or destination. */
export type EvidenceExplicitCoverageStatus = Exclude<
  EvidenceRoleStatus,
  "present" | "not-yet-recorded"
>;

/** Bounded active and historical evidence for one role. */
export interface EvidenceRoleView<R extends EvidenceRole> {
  /** Role represented by this slot. */
  readonly role: R;
  /** Honest coverage state derived from records and explicit facts. */
  readonly status: EvidenceRoleStatus;
  /** Active records after explicit supersession. */
  readonly records: readonly EvidenceRecord<R>[];
  /** Superseded records when `includeHistory` was requested. */
  readonly history?: readonly EvidenceRecord<R>[];
  /** Shared conclusion when every classified active record agrees. */
  readonly conclusion?: EvidenceConclusion<R>;
  /** Whether classified active records contain incompatible conclusions. */
  readonly conflicting: boolean;
  /** Whether the authorized result set is known to be incomplete. */
  readonly truncated: boolean;
  /** Opaque continuation for the selected role, when available. */
  readonly cursor?: string;
}

/** Five fixed evidence role slots. */
export interface EvidenceRolesView {
  /** Why the subject was attempted. */
  readonly intent: EvidenceRoleView<"intent">;
  /** Why the subject was allowed, denied, or revoked. */
  readonly authority: EvidenceRoleView<"authority">;
  /** What state transition was reported or observed. */
  readonly change: EvidenceRoleView<"change">;
  /** How the subject was checked. */
  readonly verification: EvidenceRoleView<"verification">;
  /** Whether mitigation existed and what recovery attempts concluded. */
  readonly recovery: EvidenceRoleView<"recovery">;
}

/** Immutable evidence read model for one subject. */
export interface EvidenceView {
  /** Subject described by this view. */
  readonly subject: EvidenceSubject;
  /** Source that contributed to the merged view. */
  readonly source: "active-scope" | "destination";
  /** ISO timestamp at which Core completed the snapshot. */
  readonly inspectedAt: string;
  /** Stable five-role projection. */
  readonly roles: EvidenceRolesView;
}

/** Options controlling evidence hydration and pagination. */
export interface EvidenceInspectOptions {
  /** Hydrate one role while retaining bounded summaries for every role. */
  readonly role?: EvidenceRole;
  /** Maximum hydrated rows per selected role. @default 50 */
  readonly limit?: number;
  /** Opaque continuation scoped to the selected role and query options. */
  readonly cursor?: string;
  /** Include superseded records. @default false */
  readonly includeHistory?: boolean;
  /** Request retained inline content when policy permits. @default false */
  readonly includeData?: boolean;
}
