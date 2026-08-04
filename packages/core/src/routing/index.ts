/**
 * Cost-aware model routing primitives.
 *
 * - `router()` — classifier-based model selection with typed routing context
 * - `split()` — deterministic weighted bucket selection
 * - `retry()` — retry one model on retryable failures
 * - `cascade()` — sequential quality escalation with budget enforcement
 * - `fallback()` — ordered provider/model fallback with attempt spans
 *
 * @module
 */

export { router, isRouter } from './router'
export type { RouterConfig, RouterModel, AnyRouterModel } from './router'

export { split, isSplit } from './split'
export type { SplitConfig, SplitModel, SplitRoute } from './split'

export { retry, isRetry } from './retry'
export type { RetryBackoff, RetryErrorCategory, RetryModel, RetryOptions } from './retry'

export type {
  AnyRoutable,
  BoundOf,
  BoundOk,
  CallProfile,
  CallProfileParams,
  ComposedCtx,
  ComposedStream,
  CompletedOperationModel,
  CtxOf,
  InOf,
  InputOk,
  KeysOf,
  ModelOf,
  Prettify,
  PromptInputOf,
  PromptOutputOf,
  PromptOutputSchemaOf,
  RouteArgs,
  RoutingCallOptions,
  RoutingPhantom,
  StreamOf,
} from './types'

export { cascade, isCascade } from './cascade'
export type {
  CascadeConfig,
  CascadeModel,
  CascadeTier,
  CascadeTierContext,
  CascadeBudget,
  CascadeEscalationCategory,
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
  createRoutingStreamError,
  isRoutingStreamError,
} from './errors'
export type { RoutingStreamError } from './errors'
