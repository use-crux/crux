/**
 * Readiness events emitted by the structured scanner.
 *
 * An event fires only when a value is structurally complete at its canonical
 * path: a closed string, a number/boolean/null at a legal delimiter, a completed
 * array item, or a closed object/array. The event carries the decoded value and
 * a stable sequence number in document order.
 *
 * @module
 */

/** Canonical path from the root to a value (object keys and array indexes). */
export type ReadinessPath = readonly (string | number)[]

/** One structurally-complete value at a canonical path. */
export interface ReadinessEvent {
  /** Stable document-order sequence number. */
  readonly seq: number
  /** Canonical path from the root; the root value has an empty path. */
  readonly path: ReadinessPath
  /** The decoded, structurally-complete value at `path`. */
  readonly value: unknown
}
