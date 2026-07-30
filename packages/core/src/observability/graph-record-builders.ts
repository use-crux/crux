/**
 * Pure construction of unsequenced artifact and edge graph records.
 *
 * @internal
 * @module
 */

import {
  CRUX_OBSERVABILITY_SCHEMA_VERSION,
  type CruxArtifactId,
  type CruxSpanId,
} from "./contract";
import type { ObservabilityContext } from "./context";
import {
  createCruxEdgeId,
  createCruxRecordId,
  createCruxSpanEventId,
} from "./ids";
import type {
  ObserveArtifactOptions,
  ObserveEdgeOptions,
  ObserveEventOptions,
} from "./observe";
import type { UnsequencedCruxGraphRecord } from "./sequence";

/** Construct an artifact envelope from an already captured context. */
export function buildArtifactRecord(
  context: ObservabilityContext,
  artifactId: CruxArtifactId,
  options: ObserveArtifactOptions,
  createdAt: string,
): UnsequencedCruxGraphRecord {
  const spanId = context.spanStack[context.spanStack.length - 1];
  return {
    schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
    recordId: createCruxRecordId(),
    type: "artifact",
    operationId: context.operationId,
    runId: context.runId,
    segmentId: context.segmentId,
    traceId: context.traceId,
    artifactId,
    ...(spanId ? { spanId } : {}),
    kind: options.kind,
    createdAt,
    contentType: options.contentType,
    encoding: options.encoding,
    ...(options.sizeBytes !== undefined
      ? { sizeBytes: options.sizeBytes }
      : {}),
    ...(options.hash ? { hash: options.hash } : {}),
    ...(options.preview !== undefined ? { preview: options.preview } : {}),
    ...(options.uri ? { uri: options.uri } : {}),
    ...(options.attributes ? { attributes: options.attributes } : {}),
  };
}

/** Construct an edge envelope from an already captured context. */
export function buildEdgeRecord(
  context: ObservabilityContext,
  options: ObserveEdgeOptions,
  createdAt: string,
): UnsequencedCruxGraphRecord {
  return {
    schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
    recordId: createCruxRecordId(),
    type: "edge",
    operationId: context.operationId,
    runId: context.runId,
    segmentId: context.segmentId,
    traceId: context.traceId,
    edgeId: createCruxEdgeId(),
    edgeType: options.edgeType,
    from: options.from,
    to: options.to,
    createdAt,
    ...(options.attributes ? { attributes: options.attributes } : {}),
  };
}

/** Construct a span event with an explicit, already-resolved timestamp. */
export function buildSpanEventRecord(
  context: ObservabilityContext,
  spanId: CruxSpanId,
  options: ObserveEventOptions,
  timestamp: string,
): UnsequencedCruxGraphRecord {
  return {
    schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
    recordId: createCruxRecordId(),
    type: "span:event",
    operationId: context.operationId,
    runId: context.runId,
    segmentId: context.segmentId,
    traceId: context.traceId,
    spanId,
    eventId: createCruxSpanEventId(),
    name: options.name,
    timestamp,
    ...(options.attributes ? { attributes: options.attributes } : {}),
  };
}
