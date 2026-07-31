/**
 * Thread identity generation and validation.
 *
 * IDs remain plain strings across the public API while key construction
 * escapes them before storage.
 *
 * @module
 */

import { ThreadError } from "./errors";

const MAX_ID_LENGTH = 512;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

/** Validate a stable Thread or message identity. */
export function assertThreadId(value: string, label = "Thread id"): void {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_ID_LENGTH ||
    value.trim() !== value ||
    CONTROL_CHARACTER.test(value)
  ) {
    throw new ThreadError(
      "invalid_message",
      `${label} must be a non-empty string without surrounding whitespace or control characters.`,
    );
  }
}

/** Generate a stable message identity for a one-shot append. */
export function generateThreadMessageId(): string {
  return `msg_${globalThis.crypto.randomUUID()}`;
}
