/** Exact task-evidence persistence decision for one completed live cell. */

import { createTaskEvidenceEntry } from "./evidence";
import { fingerprintEvalValue, isReusableEvalValue } from "./identity";
import type { EvalExecutionPorts } from "./ports";
import { isEvalSnapshotPersistenceSafe } from "./redact";
import { getEvalTaskDescriptorForInternalUse } from "./task";
import type { EvalPlannedCell, EvalTaskHostResult } from "./types";

export type EvidenceWriteStatus =
  | "written"
  | "failed"
  | "not_eligible"
  | "not_attempted";

export type EvidenceWriteReason =
  | "identity_unavailable"
  | "model_identity_unattested"
  | "untracked_external_dependency"
  | "task_binding_untracked"
  | "unresolved_source_dependency"
  | "implicit_media"
  | "capture_policy"
  | "observed_identity_mismatch";

/** Immutable persistence outcome consumed by run-level provenance. */
export interface EvidenceWriteOutcome {
  readonly status: EvidenceWriteStatus;
  readonly reason?: EvidenceWriteReason;
}

const NOT_ATTEMPTED = Object.freeze({
  status: "not_attempted",
}) satisfies EvidenceWriteOutcome;

/**
 * Persist exact live evidence when identity and snapshot policy permit it.
 *
 * The decision is terminal for this invocation; failures never alter the
 * already-completed task result used by scoring and assertions.
 */
export async function writeTaskEvidence(input: {
  readonly planned: EvalPlannedCell;
  readonly result: EvalTaskHostResult;
  readonly ports: EvalExecutionPorts;
}): Promise<EvidenceWriteOutcome> {
  const { action } = input.planned;
  if (
    action.kind !== "execute" ||
    action.evidenceKey === undefined ||
    action.plannedAdapterFingerprint === undefined ||
    input.ports.evidenceStore === undefined
  ) {
    return NOT_ATTEMPTED;
  }

  const identityFailure = evidenceIdentityFailure(input.planned, input.result);
  if (identityFailure !== undefined) return identityFailure;

  const entry = createTaskEvidenceEntry(
    action.evidenceKey,
    input.result,
    input.ports.persistencePolicy,
  );
  if (entry === undefined) {
    return Object.freeze({
      status: "not_eligible",
      reason: unsafeEvidenceReason(input.result, input.ports),
    });
  }

  try {
    await input.ports.evidenceStore.write(entry);
    return Object.freeze({ status: "written" });
  } catch {
    return Object.freeze({ status: "failed" });
  }
}

function evidenceIdentityFailure(
  planned: EvalPlannedCell,
  result: EvalTaskHostResult,
): EvidenceWriteOutcome | undefined {
  if (planned.action.kind !== "execute") return undefined;
  const observed = result.observedIdentity;
  if (!observed.reusable) {
    return Object.freeze({
      status: "not_eligible",
      reason: observed.reason,
    });
  }

  const observedFingerprint =
    "fingerprint" in observed
      ? observed.fingerprint
      : fingerprintEvalValue(observed.fingerprintMaterial);
  if (observedFingerprint !== planned.action.plannedAdapterFingerprint) {
    return Object.freeze({
      status: "not_eligible",
      reason: "observed_identity_mismatch",
    });
  }

  const descriptor = getEvalTaskDescriptorForInternalUse(planned.task);
  return descriptor.projectRenderedPromptIdentity !== undefined &&
    result.renderedPromptFingerprint === undefined
    ? Object.freeze({
        status: "not_eligible",
        reason: "untracked_external_dependency",
      })
    : undefined;
}

function unsafeEvidenceReason(
  result: EvalTaskHostResult,
  ports: EvalExecutionPorts,
): "implicit_media" | "capture_policy" {
  if (
    !isReusableEvalValue(result.output) ||
    (result.response !== undefined && !isReusableEvalValue(result.response))
  ) {
    return "implicit_media";
  }
  return !isEvalSnapshotPersistenceSafe(
    result.output,
    ports.persistencePolicy,
  ) ||
    (result.response !== undefined &&
      !isEvalSnapshotPersistenceSafe(result.response, ports.persistencePolicy))
    ? "capture_policy"
    : "implicit_media";
}
