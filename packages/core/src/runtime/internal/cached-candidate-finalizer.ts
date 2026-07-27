/**
 * Private cached-candidate finalization capability.
 *
 * Adapter execution attaches the capability to the middleware continuation,
 * keeping public middleware arguments provider-neutral. Semantic cache is the
 * only runtime consumer.
 *
 * @internal
 * @module
 */

import type { MiddlewareResult, PromptMiddleware } from '../types'

type PromptMiddlewareNext = Parameters<PromptMiddleware>[1]

/** Result of evaluating one hydrated cached candidate before release. */
export type CachedCandidateDecision =
  | {
      readonly kind: 'accept'
      readonly result: MiddlewareResult
    }
  | {
      readonly kind: 'reject'
      readonly category: 'schema' | 'guardrail' | 'constraint'
    }

/** Adapter-owned evaluation of a hydrated cached candidate. */
export type CachedCandidateFinalizer = (
  candidate: MiddlewareResult,
) => Promise<CachedCandidateDecision>

/** Private carrier key shared by orchestration specs and middleware `next`. */
export const cachedCandidateFinalizer: unique symbol = Symbol(
  '@use-crux/core/runtime/cachedCandidateFinalizer',
)

/** Structural private carrier for the cached-candidate capability. */
export type CachedCandidateFinalizerCarrier = {
  readonly [cachedCandidateFinalizer]?: CachedCandidateFinalizer
}

/** Attach the capability without exposing it to enumeration or serialization. */
export function attachCachedCandidateFinalizer<TTarget extends object>(
  target: TTarget,
  finalizer: CachedCandidateFinalizer,
): TTarget & CachedCandidateFinalizerCarrier {
  Object.defineProperty(target, cachedCandidateFinalizer, {
    value: finalizer,
    enumerable: false,
    writable: false,
    configurable: false,
  })
  return target
}

/** Read a finalizer from an internal carrier. */
export function readCachedCandidateFinalizer(
  carrier: object,
): CachedCandidateFinalizer | undefined {
  return (carrier as CachedCandidateFinalizerCarrier)[
    cachedCandidateFinalizer
  ]
}

/** Forward an attached finalizer to a newly composed middleware continuation. */
export function inheritCachedCandidateFinalizer<
  TTarget extends PromptMiddlewareNext,
>(
  source: PromptMiddlewareNext,
  target: TTarget,
): TTarget {
  const finalizer = readCachedCandidateFinalizer(source)
  return finalizer
    ? attachCachedCandidateFinalizer(target, finalizer)
    : target
}

/**
 * Evaluate through the attached capability, or accept unchanged when an
 * adapter did not provide one.
 */
export function finalizeCachedCandidate(
  carrier: object,
  candidate: MiddlewareResult,
): Promise<CachedCandidateDecision> {
  const finalizer = readCachedCandidateFinalizer(carrier)
  return finalizer
    ? finalizer(candidate)
    : Promise.resolve({ kind: 'accept', result: candidate })
}
