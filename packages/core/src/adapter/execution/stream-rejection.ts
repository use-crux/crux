/**
 * Typed non-terminal stream-attempt rejection causes (RFC #173, Phase 15, Fork 2).
 *
 * A rejection says only WHAT was wrong with the current (uncommitted) attempt. It never
 * carries an executable terminal-error factory: the shared retry policy owns conversion
 * to the stable public error type on exhaustion, so the terminal error stays
 * deterministic (validation → `ValidationExhaustedError`, constraint →
 * `ConstraintViolationError`, never combined).
 *
 * @module
 */

import { isStreamConstraintRejection } from "../../safety/constraint/settlement";
import type { z } from "zod";

/**
 * The authoritative `safeParse` rejected the completed attempt. Non-terminal: the
 * coordinator/plan retries when eligible, else converts it to the public
 * `ValidationExhaustedError`.
 */
export class StreamValidationRejection extends Error {
  readonly kind = "validation-rejected" as const;
  readonly error: z.ZodError;
  /** The rejected candidate's text (for the terminal error's safe summary). */
  readonly text: string;
  constructor(opts: { readonly error: z.ZodError; readonly text: string }) {
    super("Stream attempt rejected by validation");
    this.name = "StreamValidationRejection";
    this.error = opts.error;
    this.text = opts.text;
  }
}

/** Whether a thrown value is the internal non-terminal validation rejection. */
export function isStreamValidationRejection(
  value: unknown,
): value is StreamValidationRejection {
  return value instanceof StreamValidationRejection;
}

/**
 * Whether a thrown value is an internal, non-terminal stream-attempt rejection.
 *
 * @remarks
 * A type-guarded contract rather than a name comparison: a provider error can trivially
 * set `error.name = 'StreamConstraintRejection'`, and treating that as a policy decision
 * would route a transport failure into the retry path.
 */
export function isStreamAttemptRejection(value: unknown): boolean {
  return isStreamValidationRejection(value) || isStreamConstraintRejection(value);
}
