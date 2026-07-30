/**
 * `@use-crux/core/evidence` — qualified execution evidence.
 *
 * @module
 */

import { inspectEvidence } from "./inspect";
import { recordEvidence } from "./record";
import type { EvidenceRole } from "./roles";
import type { EvidenceRecordInput, EvidenceRef } from "./record-types";
import type { EvidenceSubject } from "./subjects";
import type { EvidenceInspectOptions, EvidenceView } from "./view-types";

export { CruxEvidenceError } from "./errors";
export type { CruxEvidenceErrorCode } from "./errors";
export type {
  EvidenceConclusion,
  EvidenceKind,
  EvidenceRole,
} from "./roles";
export type {
  EvidenceArtifactRef,
  EvidenceEffectReceiptRef,
  EvidenceExecutionRef,
  EvidenceSourceRef,
  EvidenceSubject,
} from "./subjects";
export type {
  CruxEvidenceId,
  EvidenceAcceptedAfterTerminal,
  EvidencePayloadState,
  EvidencePayloadUnavailableReason,
  EvidenceRecord,
  EvidenceRecordInput,
  EvidenceRef,
} from "./record-types";
export type {
  EvidenceInspectOptions,
  EvidenceExplicitCoverageStatus,
  EvidenceRolesView,
  EvidenceRoleStatus,
  EvidenceRoleView,
  EvidenceView,
} from "./view-types";
export type {
  CruxEvidenceQueryDestination,
  EvidenceDestinationInspectRequest,
  EvidenceDestinationInspectResult,
  EvidenceDestinationRoleResult,
  EvidenceDestinationRolesResult,
} from "./destination";

/** Public operations for authoring and reading execution evidence. */
export interface EvidenceApi {
  /**
   * Record one immutable qualified relationship.
   *
   * @remarks
   * Recording is synchronous. The returned reference means Core validated and
   * accepted the relationship into its local emission path; it does not claim
   * that a remote destination durably committed it. Omit `subject` inside a
   * Crux execution to target the current span or run.
   *
   * @param input - Inline custom evidence or a reference to an existing source.
   * @returns A frozen portable reference with the exact input role.
   * @throws {@link CruxEvidenceError} with `EVIDENCE_SUBJECT_REQUIRED` when no
   * explicit or ambient subject is available.
   *
   * @example
   * ```ts
   * import { evidence } from '@use-crux/core'
   *
   * const ref = evidence.record({
   *   role: 'verification',
   *   conclusion: 'passed',
   *   kind: 'custom.editorial-review',
   *   data: { approved: true },
   * })
   * ```
   */
  record<const R extends EvidenceRole>(
    input: EvidenceRecordInput<R>,
  ): EvidenceRef<R>;

  /**
   * Inspect the bounded five-role evidence view for a subject.
   *
   * @remarks
   * Source selection happens when this method is called. Active-scope records
   * provide immediate read-your-writes; inspection after the owning scope seals
   * requires a readable canonical observability destination.
   *
   * @param subject - Explicit execution, artifact, or effect-receipt subject.
   * @param options - Bounded hydration and history options.
   * @returns A frozen snapshot with all five role slots.
   * @throws {@link CruxEvidenceError} with `EVIDENCE_QUERY_UNAVAILABLE` when
   * neither the active scope nor a readable destination can answer.
   *
   * @example
   * ```ts
   * const view = await evidence.inspect(ref.subject, {
   *   role: 'verification',
   *   includeData: true,
   * })
   * ```
   */
  inspect(
    subject: EvidenceSubject,
    options?: EvidenceInspectOptions,
  ): Promise<EvidenceView>;
}

/**
 * Frozen namespace for authoring and reading qualified execution evidence.
 *
 * @remarks Evidence records immutable claims. Conflicting active claims remain
 * visible until a later record explicitly supersedes them.
 */
export const evidence: Readonly<EvidenceApi> = Object.freeze({
  record: recordEvidence,
  inspect: inspectEvidence,
});
