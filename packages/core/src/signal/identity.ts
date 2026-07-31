/** Private Signal occurrence and idempotency identities. */

import { sha256Hex } from "../content/sha256";

const textEncoder = new TextEncoder();
let fallbackOccurrenceId = 0;

/** Create a collision-resistant occurrence identity. @internal */
export function createSignalOccurrenceId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `signal_occurrence_${uuid}`;
  fallbackOccurrenceId += 1;
  return `signal_occurrence_${Date.now().toString(36)}_${fallbackOccurrenceId.toString(36)}`;
}

/** Hash a caller key without persisting the raw secret-bearing value. @internal */
export function hashSignalIdempotencyKey(
  signalId: string,
  idempotencyKey: string,
): string {
  return sha256Hex(
    textEncoder.encode(
      `crux.signal.idempotency.v1\0${signalId}\0${idempotencyKey}`,
    ),
  );
}
