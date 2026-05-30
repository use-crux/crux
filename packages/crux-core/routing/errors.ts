/**
 * Error types for routing primitives.
 *
 * @module
 */

import type { CascadeTierDetail } from './cascade'

/**
 * Thrown when all cascade tiers reject the result (including the last tier
 * when it has an evaluate function that returns false).
 */
export class CascadeExhaustedError extends Error {
  readonly _tag = 'CascadeExhaustedError' as const

  constructor(
    /** The result from the last tier that was rejected. */
    readonly lastResult: unknown,
    /** Per-tier execution details. */
    readonly tierDetails: CascadeTierDetail[],
  ) {
    super(`All ${tierDetails.length} cascade tiers were rejected`)
    this.name = 'CascadeExhaustedError'
  }
}

/**
 * Thrown when classify returns a route key that doesn't exist in routes
 * and no `default` route catches it. (Should not happen if types are correct,
 * but serves as a runtime safety net.)
 */
export class RouterClassifyError extends Error {
  readonly _tag = 'RouterClassifyError' as const

  constructor(
    /** The classification label that wasn't found. */
    readonly classifiedAs: string,
    /** The valid route keys. */
    readonly availableRoutes: string[],
  ) {
    super(
      `Router classify returned "${classifiedAs}" but no matching route found. Available: ${availableRoutes.join(', ')}`,
    )
    this.name = 'RouterClassifyError'
  }
}
