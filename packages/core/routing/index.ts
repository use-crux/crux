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
  CascadeMeta,
  CascadeTierDetail,
} from './cascade'

export { fallback, isFallback } from '../generation/fallback'
export type { FallbackModel, FallbackOptions, FallbackMeta, FallbackAttemptDetail } from '../generation/fallback'

export { resolveModel } from './resolve'
export type { RouterMeta } from './resolve'

export { CascadeExhaustedError, RouterClassifyError } from './errors'
