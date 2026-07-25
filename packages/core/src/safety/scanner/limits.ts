/**
 * Resource bounds for the structured readiness scanner.
 *
 * @module
 */

/**
 * Conservative internal nesting depth for structured provider output. Objects and
 * arrays nested beyond this fail closed with a `depth-limit` diagnostic rather
 * than growing scanner state without bound. This is an internal safety bound, not
 * a user-facing API; the byte bound reuses the caller's configured maximum
 * response size when one is supplied.
 */
export const MAX_STRUCTURED_NESTING_DEPTH = 64

/** Configurable scanner bounds. `maxBytes` reuses an existing response-size cap. */
export interface StructuredScanLimits {
  readonly maxDepth?: number
  readonly maxBytes?: number
}
