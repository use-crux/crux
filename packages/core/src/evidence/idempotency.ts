/**
 * Deterministic evidence retry identity and content equivalence.
 *
 * @internal
 * @module
 */

import { sha256Hex } from "../content/sha256";
import type {
  CruxArtifactId,
  CruxArtifactRecord,
  CruxAttributes,
  CruxGraphNodeRef,
} from "../observability";
import { canonicalEvidenceJson } from "./canonical-json";
import type { EvidenceKind, EvidenceRole } from "./roles";
import type {
  CruxEvidenceId,
  EvidenceRecord,
} from "./record-types";
import {
  evidenceSubjectKey,
  type EvidenceSubject,
} from "./subjects";

/** Current canonical representation used for durable content comparison. */
export const EVIDENCE_CONTENT_DIGEST_VERSION = 1 as const;

/** Protected marker carried by every canonical inline evidence artifact. */
export type EvidenceSourceMarker = CruxAttributes & {
  readonly evidenceSource: {
    readonly evidenceId: CruxEvidenceId;
    readonly captureState: EvidenceCandidateCaptureState;
  };
};

/** Capture states that can produce a durable inline artifact candidate. */
export type EvidenceCandidateCaptureState =
  | "available"
  | "reference"
  | "not-captured";

/** Derive a deterministic relationship ID without exposing the raw key. */
export function deterministicEvidenceId(
  subject: EvidenceSubject,
  role: EvidenceRole,
  evidenceKind: EvidenceKind,
  rawKey: string,
): CruxEvidenceId {
  return `evidence_${digest({
    subject: evidenceSubjectKey(subject),
    role,
    evidenceKind,
    key: rawKey,
  })}` as CruxEvidenceId;
}

/** Derive the safe bounded digest permitted on qualified graph metadata. */
export function evidenceIdempotencyKeyHash(rawKey: string): string {
  return digest(rawKey);
}

/** Derive the stable source-artifact ID for an idempotent relationship. */
export function deterministicEvidenceArtifactId(
  evidenceId: CruxEvidenceId,
): CruxArtifactId {
  return `artifact_${digest({ evidenceId })}` as CruxArtifactId;
}

/** Construct the bounded marker Local uses to recognize evidence sources. */
export function evidenceSourceMarker(
  evidenceId: CruxEvidenceId,
  captureState: EvidenceCandidateCaptureState,
): EvidenceSourceMarker {
  return Object.freeze({
    evidenceSource: Object.freeze({ evidenceId, captureState }),
  });
}

/**
 * Digest immutable relationship content after capture and privacy policy.
 *
 * @param record - Prepared collector record containing only retained data.
 * @param sourceMode - Whether the authored source was inline or referenced.
 * @param subject - Canonical graph-node subject sent to the destination.
 * @param source - Canonical graph-node source sent to the destination.
 * @param artifact - Final prepared artifact metadata for an inline source.
 */
export function evidenceContentDigest(
  record: EvidenceRecord,
  sourceMode: "inline" | "reference",
  subject: CruxGraphNodeRef,
  source: CruxGraphNodeRef,
  artifact?: Pick<CruxArtifactRecord, "hash" | "sizeBytes">,
): `sha256:${string}` {
  const representation = {
    version: EVIDENCE_CONTENT_DIGEST_VERSION,
    subject,
    role: record.ref.role,
    evidenceKind: record.ref.evidenceKind,
    sourceMode,
    ...(record.conclusion !== undefined
      ? { conclusion: record.conclusion }
      : {}),
    ...(record.observedAt !== undefined
      ? { observedAt: record.observedAt }
      : {}),
    supersedesEvidenceIds: record.supersedes
      .map(({ id }) => id)
      .sort(),
    source:
      sourceMode === "reference"
        ? { reference: source }
        : inlineDigestSource(record, artifact),
  };
  return `sha256:${digest(representation)}`;
}

function inlineDigestSource(
  record: EvidenceRecord,
  artifact?: Pick<CruxArtifactRecord, "hash" | "sizeBytes">,
): object {
  if (record.payloadState === "available") {
    return {
      captureState: "available",
      preview: record.data,
    };
  }
  if (record.payloadState === "reference") {
    return {
      captureState: "reference",
      ...(artifact?.hash !== undefined ? { hash: artifact.hash } : {}),
      ...(artifact?.sizeBytes !== undefined
        ? { sizeBytes: artifact.sizeBytes }
        : {}),
    };
  }
  return { captureState: record.payloadState };
}

function digest(value: unknown): string {
  return sha256Hex(
    new TextEncoder().encode(canonicalEvidenceJson(value)),
  );
}
