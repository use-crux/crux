/**
 * Conservative hydration of equivalent local and durable relationships.
 *
 * @internal
 * @module
 */

import type { EvidenceRecord } from "./record-types";

/** Add only metadata or safe data absent from the destination-owned row. */
export function hydrateEquivalentRelationship(
  existing: EvidenceRecord,
  local: EvidenceRecord,
): EvidenceRecord {
  let hydrated = existing;
  if (existing.producer === undefined && local.producer !== undefined) {
    hydrated = Object.freeze({ ...hydrated, producer: local.producer });
  }
  if (
    existing.acceptedAfterTerminal === undefined &&
    local.acceptedAfterTerminal !== undefined
  ) {
    hydrated = Object.freeze({
      ...hydrated,
      acceptedAfterTerminal: local.acceptedAfterTerminal,
    });
  }
  if (
    existing.data === undefined &&
    local.payloadState === "available" &&
    local.data !== undefined &&
    existing.payloadState !== "redacted" &&
    existing.payloadState !== "not-captured"
  ) {
    const {
      data: _data,
      payloadUnavailableReason: _reason,
      ...metadata
    } = hydrated;
    hydrated = Object.freeze({
      ...metadata,
      payloadState: "available",
      data: local.data,
    });
  }
  return hydrated;
}
