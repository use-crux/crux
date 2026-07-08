/**
 * Cost-aware model routing primitives.
 *
 * - `router()` — classifier-based model selection with typed hints
 * - `cascade()` — sequential quality escalation with budget enforcement
 * - `fallback()` — ordered provider/model fallback with attempt spans
 *
 * @module
 */

export { router, isRouter } from './router'
export type { RouterConfig, RouterModel, AnyRouterModel } from './router'

export { cascade, isCascade } from './cascade'
export type {
  CascadeConfig,
  CascadeModel,
  CascadeTier,
  CascadeTierContext,
  CascadeBudget,
  CascadeTierDetail,
} from './cascade'

export { fallback, isFallback } from '../generation/fallback'
export type { FallbackModel, FallbackOptions } from '../generation/fallback'

export { resolveModel } from './resolve'

export {
  attachRoutingToError,
  markRoutingMidStreamFailure,
} from './receipt'
export type {
  AttemptDetail,
  CascadeRoutingStep,
  FallbackRoutingStep,
  RoutingReceipt,
  RoutingStep,
  RouterRoutingStep,
  TierDetail,
} from './receipt'

export {
  CascadeExhaustedError,
  FallbackExhaustedError,
  RouterClassifyError,
  createRoutingStreamError,
  isRoutingStreamError,
} from './errors'
export type { RoutingStreamError } from './errors'
