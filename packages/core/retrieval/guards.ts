/**
 * Shared runtime guards for the retrieval domain.
 *
 * @module
 */

/** Whether a value is a non-null object (a record). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
