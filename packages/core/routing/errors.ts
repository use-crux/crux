/**
 * Error types for routing primitives.
 *
 * @module
 */

import type { CascadeTierDetail } from './cascade'
import type { AttemptDetail, RoutingReceipt } from './receipt'

/** Thrown when every fallback candidate fails. */
export class FallbackExhaustedError extends Error {
  readonly _tag = 'FallbackExhaustedError' as const

  constructor(
    /** Per-attempt execution details. */
    readonly attempts: readonly AttemptDetail[],
    /** Canonical routing receipt for the exhausted fallback. */
    readonly routing: RoutingReceipt,
    /** Original provider errors from each failed attempt. */
    readonly errors: readonly Error[],
  ) {
    super(`All ${attempts.length} fallback models failed`)
    this.name = 'FallbackExhaustedError'
  }
}

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

/** Tagged error returned when a generate-only primitive is used while streaming. */
export interface RoutingStreamError extends Error {
  readonly _tag: 'RoutingStreamError'
  /** Routing primitive that cannot serve the current streaming call. */
  readonly primitive: 'cascade'
}

/**
 * Create the streaming-mode routing error without introducing a class.
 *
 * Cascade needs a complete model result before it can evaluate or escalate, so
 * it is rejected at resolve time even when nested under router or fallback.
 */
export function createRoutingStreamError(
  primitive: RoutingStreamError['primitive'],
): RoutingStreamError {
  const error = new Error(
    `${primitive}() does not support stream(). Use generate() instead — cascade needs full results for tier evaluation.`,
  ) as RoutingStreamError
  error.name = 'RoutingStreamError'
  Object.defineProperties(error, {
    _tag: { value: 'RoutingStreamError', enumerable: true },
    primitive: { value: primitive, enumerable: true },
  })
  return error
}

/** Return true when an unknown error is a routing streaming-mode failure. */
export function isRoutingStreamError(error: unknown): error is RoutingStreamError {
  return (
    error instanceof Error &&
    '_tag' in error &&
    (error as { _tag: unknown })._tag === 'RoutingStreamError'
  )
}
