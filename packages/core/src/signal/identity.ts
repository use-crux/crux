/** Private Signal occurrence and idempotency identities. */

import { sha256Hex } from "../content/sha256";
import { createRuntimeError } from "../runtime/engine/errors";

const textEncoder = new TextEncoder();
let fallbackOccurrenceId = 0;

/** Create a collision-resistant occurrence identity. @internal */
export function createSignalOccurrenceId(): string {
  const secureId = createSecureSignalOccurrenceId();
  if (secureId) return secureId;
  fallbackOccurrenceId += 1;
  return `signal_occurrence_${Date.now().toString(36)}_${fallbackOccurrenceId.toString(36)}`;
}

/** Create a durable occurrence identity or reject without secure entropy. @internal */
export function createDurableSignalOccurrenceId(): string {
  const secureId = createSecureSignalOccurrenceId();
  if (secureId) return secureId;
  throw createRuntimeError({
    code: "CAPABILITY_MISSING",
    whatFailed:
      "Durable Signal publication could not allocate an occurrence identity.",
    why:
      "The current host does not provide secure randomness through `crypto.randomUUID()` or `crypto.getRandomValues()`.",
    whatStillWorks:
      "Process-local Signal publication can still use a process-scoped identity.",
    nextStep:
      "Run durable Signal publication in a host with Web Crypto support, then retry.",
  });
}

function createSecureSignalOccurrenceId(): string | undefined {
  try {
    const uuid = globalThis.crypto?.randomUUID?.();
    if (uuid) return `signal_occurrence_${uuid}`;
  } catch {
    // Try the lower-level secure primitive before rejecting durable use.
  }
  try {
    const bytes = new Uint8Array(16);
    if (!globalThis.crypto?.getRandomValues) return undefined;
    globalThis.crypto.getRandomValues(bytes);
    return `signal_occurrence_${[...bytes]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")}`;
  } catch {
    return undefined;
  }
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
