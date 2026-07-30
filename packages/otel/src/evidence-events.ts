/**
 * Closed OpenTelemetry projections for qualified execution evidence.
 *
 * @remarks Every attribute is selected explicitly. Qualified records never
 * pass through generic edge or span-event attribute mapping.
 *
 * @internal
 * @module
 */

import {
  CruxEdgeRecordSchema,
  CruxSpanEventRecordSchema,
  EvidenceEdgeAttributesSchema,
  type CruxGraphRecord,
  type EvidenceProducer,
} from "@use-crux/core/observability";

import type { OtelAttributes } from "./attribute-mapper";

/** A validated event plus the protected execution that authored it. */
export interface EvidenceEventProjection {
  readonly name: "crux.evidence";
  readonly attributes: OtelAttributes;
  readonly producer: EvidenceProducer;
}

/** A validated coverage or bounded coverage-conflict event. */
export interface EvidenceCoverageEventProjection {
  readonly name:
    | "crux.evidence.coverage"
    | "crux.evidence.coverage.conflict";
  readonly attributes: OtelAttributes;
}

/**
 * Project one qualified `evidence.for` relationship through its closed
 * event-only allowlist.
 */
export function evidenceEventProjection(
  record: CruxGraphRecord,
): EvidenceEventProjection | undefined {
  if (record.type !== "edge" || record.edgeType !== "evidence.for") {
    return undefined;
  }
  const edge = CruxEdgeRecordSchema.safeParse(record);
  if (!edge.success) return undefined;
  const qualified = EvidenceEdgeAttributesSchema.safeParse(
    edge.data.attributes,
  );
  if (!qualified.success) return undefined;

  const attributes = qualified.data;
  return {
    name: "crux.evidence",
    producer: attributes.producer,
    attributes: {
      "crux.evidence.id": attributes.evidenceId,
      "crux.evidence.role": attributes.role,
      "crux.evidence.kind": attributes.evidenceKind.startsWith("custom.")
        ? "custom"
        : attributes.evidenceKind,
      ...(attributes.conclusion === undefined
        ? {}
        : { "crux.evidence.conclusion": attributes.conclusion }),
      "crux.evidence.subject_kind": edge.data.to.kind,
    },
  };
}

/**
 * Project a strict coverage record without exposing its subject or generic
 * event attributes.
 */
export function evidenceCoverageEventProjection(
  record: CruxGraphRecord,
): EvidenceCoverageEventProjection | undefined {
  if (
    record.type !== "span:event" ||
    (record.name !== "evidence.coverage" &&
      record.name !== "evidence.coverage.conflict")
  ) {
    return undefined;
  }
  const event = CruxSpanEventRecordSchema.safeParse(record);
  if (!event.success) return undefined;
  const attributes = event.data.attributes;
  if (!attributes || typeof attributes.role !== "string") return undefined;

  if (event.data.name === "evidence.coverage.conflict") {
    return {
      name: "crux.evidence.coverage.conflict",
      attributes: { "crux.evidence.role": attributes.role },
    };
  }
  if (typeof attributes.status !== "string") return undefined;
  return {
    name: "crux.evidence.coverage",
    attributes: {
      "crux.evidence.role": attributes.role,
      "crux.evidence.coverage_status": attributes.status,
    },
  };
}
