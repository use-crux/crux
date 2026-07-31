/**
 * Graph-node projection and protected evidence identity checks.
 *
 * @internal
 * @module
 */

import type {
  CruxGraphNodeRef,
  CruxGraphRecord,
  CruxRunId,
  CruxSpanId,
  EvidenceEdgeAttributes,
  EvidenceProducer,
  EvidenceSourceMode,
  ObserveEdgeOptions,
} from "../observability";
import { evidenceReferenceInvalidError } from "./errors";
import type {
  EvidencePayloadState,
  EvidenceRecord,
} from "./record-types";
import type { EvidenceSourceRef, EvidenceSubject } from "./subjects";
import {
  EVIDENCE_CONTENT_DIGEST_VERSION,
  evidenceSourceMarker,
} from "./idempotency";

/** Complete durable identity attached to an idempotent evidence edge. */
export interface EvidenceDurableContentIdentity {
  readonly idempotencyKeyHash: string;
  readonly sourceMode: EvidenceSourceMode;
  readonly contentDigest: `sha256:${string}`;
}

/** Resolved source and subject nodes for one evidence relationship. @internal */
export interface EvidenceGraphProjection {
  readonly from: CruxGraphNodeRef;
  readonly producer: EvidenceProducer;
  readonly to: CruxGraphNodeRef;
}

/** Resolve existing graph nodes before collector mutation. @internal */
export function prepareEvidenceGraph(
  source: EvidenceSourceRef,
  subject: EvidenceSubject,
  producer: EvidenceProducer,
): EvidenceGraphProjection {
  return Object.freeze({
    from: resolveEvidenceGraphNode(source),
    producer: Object.freeze({ ...producer }),
    to: resolveEvidenceGraphNode(subject),
  });
}

/** Reject structural refs that cannot map to a canonical graph node. @internal */
export function assertProjectableEvidenceReference(
  reference: EvidenceSourceRef,
): void {
  resolveEvidenceGraphNode(reference);
}

/** Resolve one public evidence reference to its canonical graph node. @internal */
export function resolveEvidenceGraphNode(
  reference: EvidenceSourceRef,
): CruxGraphNodeRef {
  if (reference.kind === "artifact") {
    return Object.freeze({ kind: "artifact", id: reference.id });
  }
  if (reference.kind === "execution") {
    return isRunId(reference.id)
      ? Object.freeze({ kind: "run", id: reference.id })
      : Object.freeze({ kind: "span", id: reference.id });
  }
  throw evidenceReferenceInvalidError(
    "Effect-receipt graph resolution is unavailable until the Effects API supplies its canonical summary artifact.",
  );
}

/** Construct the qualified edge without exposing arbitrary metadata. @internal */
export function evidenceEdgeOptions(
  record: EvidenceRecord,
  projection: EvidenceGraphProjection,
  sourceMode: EvidenceSourceMode,
  payloadState: EvidencePayloadState,
  durableIdentity?: EvidenceDurableContentIdentity,
): ObserveEdgeOptions {
  return {
    edgeType: "evidence.for",
    from: projection.from,
    to: projection.to,
    attributes: {
      evidenceId: record.ref.id,
      role: record.ref.role,
      evidenceKind: record.ref.evidenceKind,
      ...(record.conclusion !== undefined
        ? { conclusion: record.conclusion }
        : {}),
      ...(record.observedAt !== undefined
        ? { observedAt: record.observedAt }
        : {}),
      recordedAt: record.ref.recordedAt,
      producer: projection.producer,
      ...(record.supersedes.length > 0
        ? {
            supersedesEvidenceIds: record.supersedes.map(({ id }) => id),
          }
        : {}),
      captureState: payloadState,
      sourceMode,
      ...(durableIdentity !== undefined
        ? {
            idempotencyKeyHash: durableIdentity.idempotencyKeyHash,
            contentDigestVersion: EVIDENCE_CONTENT_DIGEST_VERSION,
            contentDigest: durableIdentity.contentDigest,
          }
        : {}),
    } satisfies EvidenceEdgeAttributes,
  };
}

/** Check the source identity after the last-mile privacy hook. @internal */
export function hasProtectedArtifactIdentity(
  artifact: Extract<CruxGraphRecord, { readonly type: "artifact" }>,
  record: EvidenceRecord,
): boolean {
  return (
    record.source.kind === "artifact" &&
    artifact.artifactId === record.source.id &&
    artifact.kind === record.ref.evidenceKind &&
    record.payloadState !== "redacted" &&
    sameJson(
      artifact.attributes,
      evidenceSourceMarker(record.ref.id, record.payloadState),
    )
  );
}

/** Check the relationship identity after the last-mile privacy hook. @internal */
export function hasProtectedEdgeIdentity(
  edge: Extract<CruxGraphRecord, { readonly type: "edge" }>,
  record: EvidenceRecord,
  projection: EvidenceGraphProjection,
  sourceMode: EvidenceSourceMode,
  payloadState: EvidencePayloadState,
  durableIdentity?: EvidenceDurableContentIdentity,
): boolean {
  return (
    edge.edgeType === "evidence.for" &&
    sameJson(edge.from, projection.from) &&
    sameJson(edge.to, projection.to) &&
    sameJson(
      edge.attributes,
      evidenceEdgeOptions(
        record,
        projection,
        sourceMode,
        payloadState,
        durableIdentity,
      ).attributes,
    )
  );
}

function isRunId(id: CruxRunId | CruxSpanId): id is CruxRunId {
  return id.startsWith("run_");
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
