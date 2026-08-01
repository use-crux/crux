/** Lossless persisted payload boundary for durable Signal occurrences. */

import type { JsonValue } from "../../storage";
import {
  canonicalSignalJson,
  cloneSignalJson,
  freezeSignalJson,
} from "../../signal/canonical-json";
import { createRuntimeError } from "../engine/errors";

/** Codec discriminator stored beside newly accepted Signal payloads. */
export const SIGNAL_PAYLOAD_CODEC = "crux.signal-json.v1" as const;

/** Supported persisted Signal payload codec. */
export type SignalPayloadCodec = typeof SIGNAL_PAYLOAD_CODEC;

/**
 * Encode normalized Signal JSON for adapter persistence.
 *
 * @remarks Adapters must round-trip the returned string opaquely. The encoding
 * preserves finite JavaScript JSON values such as negative zero that ordinary
 * stringify/parse cloning rewrites.
 */
export function encodeSignalPayload(payload: JsonValue): string {
  return canonicalSignalJson(payload);
}

/**
 * Decode and recursively freeze one persisted Signal payload.
 *
 * @remarks An omitted codec reads legacy raw records. Every result is detached
 * from adapter-owned state before it crosses the public occurrence boundary.
 */
export function decodeSignalPayload(
  payload: JsonValue,
  codec?: string,
): JsonValue {
  if (codec === undefined) {
    return freezeSignalJson(cloneSignalJson(payload, "normalized output"));
  }
  if (codec !== SIGNAL_PAYLOAD_CODEC || typeof payload !== "string") {
    return invalidPersistedSignalPayload();
  }
  try {
    const decoded: unknown = JSON.parse(payload);
    return freezeSignalJson(
      cloneSignalJson(decoded as JsonValue, "normalized output"),
    );
  } catch {
    return invalidPersistedSignalPayload();
  }
}

function invalidPersistedSignalPayload(): never {
  throw createRuntimeError({
    code: "PAYLOAD_NOT_JSON",
    whatFailed: "Runtime could not decode a persisted Signal payload.",
    why: "The occurrence payload codec or encoded JSON is invalid.",
    whatStillWorks:
      "Legacy raw Signal records and valid encoded occurrences can still replay.",
    nextStep:
      "Repair the occurrence with a supported Signal payload codec or replay it from its source.",
  });
}
