/**
 * Incremental structured readiness scanner (RFC #173).
 *
 * @module
 */

export { createStructuredReadinessScanner, type StructuredReadinessScanner } from './scanner'
export type { ReadinessEvent, ReadinessPath } from './events'
export { StructuredScanError, type StructuredScanErrorCode } from './errors'
export { MAX_STRUCTURED_NESTING_DEPTH, type StructuredScanLimits } from './limits'
export { itemMatchesSelector, pathMatchesSelector, selectorSegments } from './selector'
