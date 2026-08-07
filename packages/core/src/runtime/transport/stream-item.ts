/**
 * Pure StreamItem / cursor contract validation for managed stream transports.
 *
 * @remarks Kept free of store and worker imports so fiber code and unit tests
 * share one contract path. Full envelope accept validation still happens in
 * the shared #337 kernel after mapping.
 *
 * @module
 */

import type { JsonValue } from "../../storage/types";
import type { RuntimeAcceptedTransportPayload } from "./contracts";
import { MAX_TRANSPORT_BINDING_CURSOR_BYTES } from "./binding-checkpoint";
import type { StreamCursorItem, StreamEnvelopeItem, StreamItem } from "../../signal/transport/stream";

/** Stable contract-violation code for invalid stream items. */
export const TRANSPORT_STREAM_CONTRACT_INVALID =
  "TRANSPORT_STREAM_CONTRACT_INVALID" as const;

/**
 * Validate one yielded stream item.
 *
 * @param value - Raw yield from a provider `open` iterator.
 * @returns A detached, validated {@link StreamItem}.
 * @throws {TypeError} When the item is missing required fields or has a bad shape.
 * @throws {RangeError} When a cursor exceeds {@link MAX_TRANSPORT_BINDING_CURSOR_BYTES}.
 */
export function validateStreamItem(value: unknown): StreamItem {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw contractError(
      "stream item must be a single object (one envelope or cursor item; no batches).",
    );
  }

  const record = value as {
    readonly kind?: unknown;
    readonly accountId?: unknown;
    readonly eventId?: unknown;
    readonly authenticatedRouting?: unknown;
    readonly payload?: unknown;
    readonly cursor?: unknown;
  };

  if (record.kind === "cursor") {
    return validateCursorItem(record);
  }

  if (record.kind === "envelope") {
    return validateEnvelopeItem(record);
  }

  throw contractError(
    'stream item kind must be "envelope" or "cursor".',
  );
}

/**
 * Validate an opaque stream cursor string or `null`.
 *
 * @param cursor - Provider resume position, or `null` to clear.
 * @returns The validated cursor value.
 * @throws {TypeError} For empty, untrimmed, or control-bearing strings.
 * @throws {RangeError} When UTF-8 size exceeds the durable cursor limit.
 */
export function validateStreamCursor(cursor: string | null): string | null {
  if (cursor === null) {
    return null;
  }

  if (typeof cursor !== "string") {
    throw contractError(
      "stream cursor must be a non-empty trimmed string without ASCII controls, or null.",
    );
  }

  if (!cursor || cursor.trim() !== cursor || /[\x00-\x1f\x7f]/.test(cursor)) {
    throw contractError(
      "stream cursor must be a non-empty trimmed string without ASCII controls, or null.",
    );
  }

  if (
    new TextEncoder().encode(cursor).byteLength >
    MAX_TRANSPORT_BINDING_CURSOR_BYTES
  ) {
    throw new RangeError(
      `stream cursor must be at most ${MAX_TRANSPORT_BINDING_CURSOR_BYTES} UTF-8 bytes.`,
    );
  }

  return cursor;
}

function validateCursorItem(record: {
  readonly cursor?: unknown;
}): StreamCursorItem {
  if (!("cursor" in record)) {
    throw contractError('cursor-only stream items require a "cursor" field.');
  }

  if (record.cursor !== null && typeof record.cursor !== "string") {
    throw contractError(
      "stream cursor must be a non-empty trimmed string without ASCII controls, or null.",
    );
  }

  return Object.freeze({
    kind: "cursor" as const,
    cursor: validateStreamCursor(record.cursor as string | null),
  });
}

function validateEnvelopeItem(record: {
  readonly accountId?: unknown;
  readonly eventId?: unknown;
  readonly authenticatedRouting?: unknown;
  readonly payload?: unknown;
  readonly cursor?: unknown;
}): StreamEnvelopeItem {
  const accountId = requireNonEmptyIdentifier(record.accountId, "accountId");
  const eventId = requireNonEmptyIdentifier(record.eventId, "eventId");

  if (
    record.authenticatedRouting === null ||
    typeof record.authenticatedRouting !== "object" ||
    Array.isArray(record.authenticatedRouting)
  ) {
    throw contractError(
      "stream envelope authenticatedRouting must be a plain object.",
    );
  }

  if (
    record.payload === null ||
    typeof record.payload !== "object" ||
    Array.isArray(record.payload)
  ) {
    throw contractError("stream envelope payload must be a payload object.");
  }

  const payload = record.payload as RuntimeAcceptedTransportPayload;
  if (
    payload.kind !== "inline-base64url" &&
    payload.kind !== "durable-ref"
  ) {
    throw contractError(
      'stream envelope payload.kind must be "inline-base64url" or "durable-ref".',
    );
  }

  const item: StreamEnvelopeItem = {
    kind: "envelope",
    accountId,
    eventId,
    authenticatedRouting: record.authenticatedRouting as Readonly<
      Record<string, JsonValue>
    >,
    payload,
  };

  if (!("cursor" in record) || record.cursor === undefined) {
    return Object.freeze(item);
  }

  if (record.cursor !== null && typeof record.cursor !== "string") {
    throw contractError(
      "stream cursor must be a non-empty trimmed string without ASCII controls, or null.",
    );
  }

  return Object.freeze({
    ...item,
    cursor: validateStreamCursor(record.cursor as string | null),
  });
}

function requireNonEmptyIdentifier(value: unknown, field: string): string {
  if (typeof value !== "string" || !value || value.trim() !== value) {
    throw contractError(
      `stream envelope ${field} must be a non-empty trimmed string.`,
    );
  }

  return value;
}

function contractError(message: string): TypeError {
  const error = new TypeError(
    `${TRANSPORT_STREAM_CONTRACT_INVALID}: ${message}`,
  );
  (error as TypeError & { code: string }).code =
    TRANSPORT_STREAM_CONTRACT_INVALID;
  return error;
}
