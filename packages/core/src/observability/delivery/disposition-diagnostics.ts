/**
 * Privacy-safe projection of per-record transport dispositions.
 *
 * @internal
 * @module
 */

import type { CruxEvidenceId } from "../../evidence/record-types";
import { EvidenceEdgeAttributesSchema } from "../evidence-edge-schema";
import type { CruxGraphRecord } from "../contract";
import type { DeliveryDispositionRecord } from "./receipt";
import { recordDeliveryError, type DeliveryState } from "./state";

/**
 * Preserve exact bounded disposition codes without forwarding destination
 * messages, payloads, subjects, keys, or content digests.
 */
export function recordBatchDispositionDiagnostics(
  state: DeliveryState,
  records: readonly CruxGraphRecord[],
  rejections: readonly DeliveryDispositionRecord[],
  fallback: { readonly code: string; readonly message: string },
): void {
  const diagnosed = recordDispositionDiagnostics(state, rejections);
  const unclassified = records.filter((record) => !diagnosed.has(record));
  if (unclassified.length > 0) {
    recordDeliveryError(state, fallback.code, fallback.message, unclassified);
  }
}

/**
 * Preserve only qualified evidence diagnostics when no generic fallback
 * applies, such as a receipt from a transport superseded in flight.
 */
export function recordEvidenceDispositionDiagnostics(
  state: DeliveryState,
  rejections: readonly DeliveryDispositionRecord[],
): void {
  recordDispositionDiagnostics(state, rejections);
}

function recordDispositionDiagnostics(
  state: DeliveryState,
  rejections: readonly DeliveryDispositionRecord[],
): ReadonlySet<CruxGraphRecord> {
  const grouped = new Map<string, DeliveryDispositionRecord[]>();
  for (const rejection of rejections) {
    if (
      !rejection.disposition.code.startsWith("EVIDENCE_") ||
      evidenceIdForRecord(rejection.record) === undefined
    ) {
      continue;
    }
    const group = grouped.get(rejection.disposition.code);
    if (group) group.push(rejection);
    else grouped.set(rejection.disposition.code, [rejection]);
  }
  for (const [code, group] of grouped) {
    const retryable = group[0]?.disposition.retryable === true;
    recordDeliveryError(
      state,
      code,
      retryable
        ? "destination requested a retry for observability records"
        : "destination permanently rejected observability records",
      group.map(({ record }) => record),
      group.flatMap(({ record }) => {
        const evidenceId = evidenceIdForRecord(record);
        return evidenceId === undefined ? [] : [evidenceId];
      }),
    );
  }
  return new Set(
    [...grouped.values()].flatMap((group) => group.map(({ record }) => record)),
  );
}

function evidenceIdForRecord(
  record: CruxGraphRecord,
): CruxEvidenceId | undefined {
  if (record.type === "edge" && record.edgeType === "evidence.for") {
    const parsed = EvidenceEdgeAttributesSchema.safeParse(record.attributes);
    return parsed.success ? parsed.data.evidenceId : undefined;
  }
  if (record.type !== "artifact" || !isObject(record.attributes)) {
    return undefined;
  }
  const marker = Reflect.get(record.attributes, "evidenceSource");
  if (!isObject(marker)) return undefined;
  const evidenceId = Reflect.get(marker, "evidenceId");
  return typeof evidenceId === "string" &&
    /^evidence_[0-9a-f]{16,64}$/u.test(evidenceId)
    ? (evidenceId as CruxEvidenceId)
    : undefined;
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
