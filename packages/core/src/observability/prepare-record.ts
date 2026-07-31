/**
 * One-pass privacy and validation preparation for observability records.
 *
 * @internal
 * @module
 */

import type {
  CruxArtifactId,
  CruxGraphRecord,
} from "./contract";
import {
  applyObservabilityCaptureModesToRecord,
  applyObservabilityRedactionToRecord,
} from "./capture-policy";
import { sanitizeRecord } from "./sanitize";
import { applyRedaction } from "../shared/redaction";
import { validateRecordForEmission } from "./validate-record";
import { getHooks } from "../runtime/runtime";
import { redactSanitizedObservabilityRecordDetailed } from "./redaction-record";
import {
  attachObservabilityRedactionEvidence,
  canonicalizeObservabilityRedactionSurfaces,
} from "./redaction-evidence";
import { normalizeObservabilityRedactionPatterns } from "./redaction-patterns";

/** Result of preparing a record without publishing it. @internal */
export type PreparedObservabilityRecord =
  | {
      readonly ok: true;
      readonly record: CruxGraphRecord;
      readonly artifactCapture?: "available" | "not-captured" | "reference";
    }
  | {
      readonly ok: false;
      readonly reason: "invalid" | "redacted";
      readonly detail?: unknown;
    };

/** Prepared artifact result used by Core-owned atomic graph producers. */
export type PreparedObservabilityArtifact =
  | {
      readonly ok: true;
      readonly artifactId: CruxArtifactId;
      readonly record: Extract<CruxGraphRecord, { readonly type: "artifact" }>;
      readonly artifactCapture?: "available" | "not-captured" | "reference";
    }
  | {
      readonly ok: false;
      readonly artifactId: CruxArtifactId;
      readonly reason: "invalid" | "redacted";
      readonly detail?: unknown;
    };

/** Prepared edge result used by Core-owned atomic graph producers. */
export type PreparedObservabilityEdge =
  | {
      readonly ok: true;
      readonly record: Extract<CruxGraphRecord, { readonly type: "edge" }>;
    }
  | Exclude<PreparedObservabilityRecord, { readonly ok: true }>;

/** Prepared span-event result used by Core-owned qualified event producers. */
export type PreparedObservabilityEvent =
  | {
      readonly ok: true;
      readonly record: Extract<
        CruxGraphRecord,
        { readonly type: "span:event" }
      >;
    }
  | Exclude<PreparedObservabilityRecord, { readonly ok: true }>;

/**
 * Apply capture, optional preview-path redaction, last-mile redaction,
 * sanitization, and validation exactly once.
 *
 * @param record - Sequenced record ready for privacy processing.
 * @param previewRedactPaths - Paths applied only to an artifact preview that
 * survives capture.
 * @returns A publishable record or a closed failure result.
 */
export function prepareObservabilityRecord(
  record: CruxGraphRecord,
  previewRedactPaths?: readonly string[],
): PreparedObservabilityRecord {
  let captured: ReturnType<typeof applyObservabilityCaptureModesToRecord>;
  try {
    captured = applyObservabilityCaptureModesToRecord(record);
  } catch (error) {
    return {
      ok: false,
      reason: "redacted",
      detail: error,
    };
  }
  if (!hasGraphEnvelope(captured.record)) {
    return {
      ok: false,
      reason: "invalid",
      detail: ["Capture policy produced an invalid observability envelope."],
    };
  }
  const artifactCapture = artifactCaptureState(record, captured.record);
  const pathRedacted = redactArtifactPreview(
    captured.record,
    previewRedactPaths,
  );
  const privacy = applyObservabilityRedactionToRecord(pathRedacted);
  if (!privacy.ok) {
    return {
      ok: false,
      reason: "redacted",
      ...(privacy.error !== undefined ? { detail: privacy.error } : {}),
    };
  }
  if (!sameProtectedEnvelopeIdentity(captured.record, privacy.record)) {
    return {
      ok: false,
      reason: "redacted",
      detail: new Error(
        "Observability redaction cannot rewrite protected envelope identity",
      ),
    };
  }

  try {
    const patterns = normalizeObservabilityRedactionPatterns(
      getHooks().observabilityCapture?.redactPatterns,
    );
    const finalRedaction = redactSanitizedObservabilityRecordDetailed(
      sanitizeRecord(privacy.record),
      patterns,
    );
    const prepared = attachObservabilityRedactionEvidence(
      finalRedaction.value,
      canonicalizeObservabilityRedactionSurfaces([
        ...captured.redactionSurfaces,
        ...privacy.redactionSurfaces,
        ...finalRedaction.surfaces,
      ]),
    );
    const validated = validateRecordForEmission(prepared);
    return validated.ok
      ? {
          ...validated,
          ...(artifactCapture ? { artifactCapture } : {}),
        }
      : {
          ok: false,
          reason: "invalid",
          detail: validated.issues,
        };
  } catch (error) {
    return {
      ok: false,
      reason: "invalid",
      detail: [
        "Record validation threw unexpectedly",
        String(error),
      ],
    };
  }
}

function hasGraphEnvelope(value: unknown): value is CruxGraphRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "type") === "string" &&
    typeof Reflect.get(value, "recordId") === "string"
  );
}

function artifactCaptureState(
  original: CruxGraphRecord,
  captured: CruxGraphRecord,
): "available" | "not-captured" | "reference" | undefined {
  if (original.type !== "artifact" || original.preview === undefined) {
    return undefined;
  }
  if (captured.type === "artifact" && captured.preview !== undefined) {
    return "available";
  }
  return captured.type === "artifact" &&
    (captured.sizeBytes !== undefined || captured.hash !== undefined)
    ? "reference"
    : "not-captured";
}

function redactArtifactPreview(
  record: CruxGraphRecord,
  paths: readonly string[] | undefined,
): CruxGraphRecord {
  if (
    record.type !== "artifact" ||
    record.preview === undefined ||
    paths === undefined
  ) {
    return record;
  }
  return {
    ...record,
    preview: applyRedaction(record.preview, paths),
  };
}

function sameProtectedEnvelopeIdentity(
  before: CruxGraphRecord,
  after: CruxGraphRecord,
): boolean {
  return (
    before.type === after.type &&
    before.schemaVersion === after.schemaVersion &&
    before.recordId === after.recordId &&
    before.operationId === after.operationId &&
    before.runId === after.runId &&
    before.segmentId === after.segmentId &&
    before.traceId === after.traceId &&
    before.segmentSeq === after.segmentSeq &&
    before.deployment?.projectId === after.deployment?.projectId &&
    before.deployment?.manifestId === after.deployment?.manifestId &&
    before.deployment?.deploymentId === after.deployment?.deploymentId
  );
}
