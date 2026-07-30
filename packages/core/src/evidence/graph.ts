/**
 * Canonical observability projection for accepted evidence relationships.
 *
 * @internal
 * @module
 */

import type { JsonValue } from "../storage";
import type { CruxGraphRecord } from "../observability";
import {
  prepareObservabilityArtifact,
  prepareObservabilityEdge,
  publishPreparedObservabilityBatch,
  reportPreparedObservabilityFailure,
} from "../observability/observe";
import {
  evidenceEdgeOptions,
  hasProtectedArtifactIdentity,
  hasProtectedEdgeIdentity,
  type EvidenceDurableContentIdentity,
  type EvidenceGraphProjection,
} from "./graph-identity";
export {
  assertProjectableEvidenceReference,
  prepareEvidenceGraph,
} from "./graph-identity";
import type {
  EvidencePayloadState,
  EvidenceRecord,
} from "./record-types";
import {
  evidenceContentDigest,
  evidenceSourceMarker,
} from "./idempotency";
import { cloneAndFreezeEvidenceJson } from "./freeze-json";

interface PreparedEvidenceGraph<R extends EvidenceRecord = EvidenceRecord> {
  readonly record: R;
  readonly records: readonly CruxGraphRecord[];
  readonly contentFingerprint?: string;
}

/**
 * Prepare the artifact and relationship once, without publishing either.
 *
 * @internal
 */
export function prepareEvidenceGraphEmission<R extends EvidenceRecord>(
  candidate: R,
  projection: EvidenceGraphProjection,
  idempotencyKeyHash?: string,
): PreparedEvidenceGraph<R> {
  if (candidate.data === undefined) {
    return prepareReferencedEvidence(
      candidate,
      projection,
      idempotencyKeyHash,
    );
  }

  const artifact = prepareObservabilityArtifact(
    {
      artifactId:
        candidate.source.kind === "artifact"
          ? candidate.source.id
          : undefined,
      kind: candidate.ref.evidenceKind,
      contentType: "application/json",
      encoding: "json",
      preview: candidate.data,
      attributes: evidenceSourceMarker(candidate.ref.id, "available"),
    },
    true,
  );
  const initialState = payloadStateForArtifact(artifact);
  const preparedRecord =
    initialState === "available" &&
    artifact.ok &&
    artifact.record.preview !== undefined
      ? withSafeData(candidate, artifact.record.preview as JsonValue)
      : withoutPayload(
          candidate,
          initialState === "available" ? "redacted" : initialState,
        );
  const durableIdentity = prepareDurableIdentity(
    preparedRecord,
    "inline",
    idempotencyKeyHash,
    projection,
    artifact.ok ? artifact.record : undefined,
  );
  const edge = prepareObservabilityEdge(
    evidenceEdgeOptions(
      preparedRecord,
      projection,
      "inline",
      preparedRecord.payloadState,
      durableIdentity,
    ),
  );
  const artifactIdentitySafe =
    artifact.ok &&
    hasProtectedArtifactIdentity(
      artifact.record,
      preparedRecord,
    );
  const edgeIdentitySafe =
    edge.ok &&
    hasProtectedEdgeIdentity(
      edge.record,
      preparedRecord,
      projection,
      "inline",
      preparedRecord.payloadState,
      durableIdentity,
    );
  if (
    !artifact.ok ||
    !edge.ok ||
    !artifactIdentitySafe ||
    !edgeIdentitySafe
  ) {
    reportFailure(artifact);
    reportFailure(edge);
    if (artifact.ok && !artifactIdentitySafe) {
      reportProtectedIdentityRewrite("artifact");
    }
    if (edge.ok && !edgeIdentitySafe) {
      reportProtectedIdentityRewrite("edge");
    }
    return {
      record: withoutPayload(candidate, "redacted"),
      records: Object.freeze([]),
      ...(durableIdentity !== undefined
        ? { contentFingerprint: durableIdentity.contentDigest }
        : {}),
    };
  }

  if (preparedRecord.payloadState === "redacted") {
    return {
      record: preparedRecord,
      records: Object.freeze([]),
      ...(durableIdentity !== undefined
        ? { contentFingerprint: durableIdentity.contentDigest }
        : {}),
    };
  }
  return {
    record: preparedRecord,
    records: Object.freeze([artifact.record, edge.record]),
    ...(durableIdentity !== undefined
      ? { contentFingerprint: durableIdentity.contentDigest }
      : {}),
  };
}

/** Publish a successfully prepared graph batch after collector acceptance. */
export function publishEvidenceGraph(
  prepared: PreparedEvidenceGraph,
): void {
  publishPreparedObservabilityBatch(prepared.records);
}

function prepareReferencedEvidence<R extends EvidenceRecord>(
  candidate: R,
  projection: EvidenceGraphProjection,
  idempotencyKeyHash?: string,
): PreparedEvidenceGraph<R> {
  const preparedRecord = withoutPayload(candidate, "reference");
  const durableIdentity = prepareDurableIdentity(
    preparedRecord,
    "reference",
    idempotencyKeyHash,
    projection,
  );
  const edge = prepareObservabilityEdge(
    evidenceEdgeOptions(
      preparedRecord,
      projection,
      "reference",
      "reference",
      durableIdentity,
    ),
  );
  const edgeIdentitySafe =
    edge.ok &&
    hasProtectedEdgeIdentity(
      edge.record,
      preparedRecord,
      projection,
      "reference",
      "reference",
      durableIdentity,
    );
  if (!edge.ok || !edgeIdentitySafe) {
    reportFailure(edge);
    if (edge.ok) reportProtectedIdentityRewrite("edge");
    return {
      record: withoutPayload(candidate, "redacted"),
      records: Object.freeze([]),
      ...(durableIdentity !== undefined
        ? { contentFingerprint: durableIdentity.contentDigest }
        : {}),
    };
  }
  return {
    record: preparedRecord,
    records: Object.freeze([edge.record]),
    ...(durableIdentity !== undefined
      ? { contentFingerprint: durableIdentity.contentDigest }
      : {}),
  };
}

function prepareDurableIdentity(
  record: EvidenceRecord,
  sourceMode: "inline" | "reference",
  idempotencyKeyHash: string | undefined,
  projection: EvidenceGraphProjection,
  artifact?: Extract<CruxGraphRecord, { readonly type: "artifact" }>,
): EvidenceDurableContentIdentity | undefined {
  if (idempotencyKeyHash === undefined) return undefined;
  return Object.freeze({
    idempotencyKeyHash,
    sourceMode,
    contentDigest: evidenceContentDigest(
      record,
      sourceMode,
      projection.to,
      projection.from,
      artifact,
    ),
  });
}

function payloadStateForArtifact(
  artifact: ReturnType<typeof prepareObservabilityArtifact>,
): EvidencePayloadState {
  if (!artifact.ok) return "redacted";
  return artifact.artifactCapture ?? "redacted";
}

function withoutPayload<R extends EvidenceRecord>(
  record: R,
  payloadState: EvidencePayloadState,
): R {
  const { data: _data, ...safe } = record;
  return Object.freeze({ ...safe, payloadState }) as R;
}

function withSafeData<R extends EvidenceRecord>(
  record: R,
  data: JsonValue,
): R {
  return Object.freeze({
    ...record,
    payloadState: "available",
    data: cloneAndFreezeEvidenceJson(data),
  }) as unknown as R;
}

function reportFailure(
  result:
    | ReturnType<typeof prepareObservabilityArtifact>
    | ReturnType<typeof prepareObservabilityEdge>,
): void {
  if (!result.ok) reportPreparedObservabilityFailure(result);
}

function reportProtectedIdentityRewrite(recordType: "artifact" | "edge"): void {
  reportPreparedObservabilityFailure({
    ok: false,
    reason: "redacted",
    detail: new Error(
      `Observability redaction cannot rewrite protected evidence ${recordType} identity.`,
    ),
  });
}
