/**
 * Streaming constraint settlement + the internal non-terminal rejection signal
 * (RFC #173, Phase 15).
 *
 * A live stream evaluates an `assert` constraint attempt but must NOT decide retry
 * eligibility. On failure it raises {@link StreamConstraintRejection} — an
 * explicitly non-terminal signal that never escapes as the public exhausted error.
 * The shared stream-attempt coordinator consumes it and retries when eligible; a
 * standalone `Safety.openStream()` (no regeneration authority) translates it to the
 * public {@link ConstraintViolationError}. {@link ConstraintSettlement} is the
 * candidate-bound evidence threaded into completion so a settled occurrence is not
 * re-evaluated; it never crosses attempts.
 *
 * @module
 */

import type { ConstraintAuditEntry, ConstraintSeverity } from './types'

/** A failed `assert` on one attempt, with its per-constraint retry ceiling. */
export interface StreamConstraintFailure {
  readonly name: string
  readonly category?: string
  readonly severity: ConstraintSeverity
  readonly feedback: string
  /** Per-constraint `maxRetries`; the coordinator gates retry on it + shared steps. */
  readonly maxRetries: number
}

/**
 * One settled constraint occurrence on an attempt. Settlement means "this exact
 * occurrence VALUE passed", not merely "this constraint ran": {@link subjectFingerprint}
 * pins the canonical subject that was evaluated, so a terminal re-check is suppressed
 * only when the same occurrence still has the same subject.
 */
export interface ConstraintOccurrenceSettlement {
  readonly constraint: string
  /** The occurrence path/index; empty for whole-output boundaries. */
  readonly occurrence: readonly (string | number)[]
  /** Stable canonical fingerprint of the evaluated subject value. */
  readonly subjectFingerprint: string
  readonly pass: boolean
  /** Whether the selected occurrence set is closed (no later occurrence can arrive). */
  readonly closed: boolean
}

/**
 * Candidate-bound evidence of every constraint settled on one attempt, threaded
 * into completion so a settled occurrence is not re-evaluated. A retried attempt
 * starts with NO settlement from its predecessor.
 */
export interface ConstraintSettlement {
  readonly attemptId: string
  readonly settled: readonly ConstraintOccurrenceSettlement[]
  readonly audit: readonly ConstraintAuditEntry[]
}

/**
 * Internal, explicitly NON-terminal signal that an `assert` rejected the current
 * (uncommitted) stream attempt. Never marked policy-terminal and never surfaced as
 * the public exhausted error — the coordinator retries, or the standalone stream
 * translates it.
 */
export class StreamConstraintRejection extends Error {
  readonly failures: readonly StreamConstraintFailure[]
  /** The rejected attempt's text (for the terminal error's `lastOutput`). */
  readonly text: string
  readonly settlement: ConstraintSettlement

  constructor(opts: {
    readonly failures: readonly StreamConstraintFailure[]
    readonly text: string
    readonly settlement: ConstraintSettlement
  }) {
    super(`Stream attempt rejected by ${opts.failures.map((failure) => failure.name).join(', ')}`)
    this.name = 'StreamConstraintRejection'
    this.failures = opts.failures
    this.text = opts.text
    this.settlement = opts.settlement
  }
}

/** Whether a thrown value is the internal non-terminal stream rejection. */
export function isStreamConstraintRejection(value: unknown): value is StreamConstraintRejection {
  return value instanceof StreamConstraintRejection
}
