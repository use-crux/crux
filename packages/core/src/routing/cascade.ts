/**
 * Sequential quality escalation — tries cheap models first,
 * escalates to expensive models when quality evaluation fails.
 *
 * @module
 */

import type {
  BoundOf,
  ComposedCtx,
  InOf,
  PromptInputOf,
  PromptOutputOf,
  RoutingPhantom,
} from './types'
import type { AnyPrompt } from '../prompt'

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

/** Cost-bearing score result accepted by cascade evaluator `report()`. */
export interface CascadeReportResult {
  /** Normalized judge or scorer value used by the evaluator. */
  readonly score: number
  /** Optional cost reported by the judge call. */
  readonly cost?: number
  /** Optional routing receipt from a routed judge call. */
  readonly routing?: { readonly cost: number | undefined }
}

/** Evaluation context passed to each tier's evaluate function. */
export interface CascadeTierContext<TResult = unknown, TIn = unknown> {
  /** The prompt output or adapter result that this tier produced. */
  readonly result: TResult
  /** Prompt input from the current generation call. */
  readonly input: TIn
  /** The model ID that produced this result. */
  readonly model: string
  /** Cost of this tier's generation (undefined if provider doesn't report it). */
  readonly cost: number | undefined
  /** 0-based index of this tier. */
  readonly tierIndex: number
  /** Cumulative cost across all tiers so far (including this one). */
  readonly totalCost: number
  /**
   * Await a judge/scorer result and fold its reported cost into cascade
   * accounting before the evaluator returns.
   */
  report: <S extends CascadeReportResult>(score: S | Promise<S>) => Promise<S>
}

/** Structured evaluation result for a cascade tier. */
export interface CascadeTierEvaluation {
  accepted: boolean
  /** Optional human-readable explanation for observability. */
  note?: string
  /** Optional quality/confidence score produced by the evaluator. */
  confidence?: number
  /** Optional threshold/budget the evaluator compared against. */
  budget?: number
}

export type CascadeTierEvaluationResult = boolean | CascadeTierEvaluation

/** Error-like result categories that may escalate a tier instead of throwing. */
export type CascadeEscalationCategory = 'invalid_response' | 'input_limit'

/** A single tier in a cascade. */
export interface CascadeTier<M, TResult = unknown, TIn = unknown> {
  /** The model (or model wrapper like fallback) for this tier. */
  model: M
  /** Error categories that should reject this tier and continue the cascade. */
  escalateOn?: readonly CascadeEscalationCategory[]
  /** Optional threshold/budget label to include in observability reports. */
  budget?: number
  /** Optional static note to include in observability reports. */
  note?: string
  /**
   * Evaluate the result. Return true to accept, false to try next tier, or a
   * structured result to include confidence/note/budget in observability.
   */
  evaluate?: (
    args: CascadeTierContext<TResult, TIn>,
  ) => CascadeTierEvaluationResult | Promise<CascadeTierEvaluationResult>
}

/** Budget constraints for cascade execution. */
export interface CascadeBudget {
  /** Maximum cumulative cost in USD. Best-effort — requires provider cost data. */
  maxCost?: number
  /** Maximum wall-clock time in ms across all tiers. */
  maxLatencyMs?: number
}

/** Configuration for a cascade. */
export interface CascadeConfig<M, TResult = unknown, TIn = unknown> {
  /** Stable id used to join authored index definitions with routing spans. */
  id?: string
  /** Human-readable description for index and devtools surfaces. */
  description?: string
  /** Optional prompt that binds this cascade to one generation surface. */
  prompt?: AnyPrompt
  /** Tiers to try in order. At least one required. */
  tiers: readonly [CascadeTier<M, TResult, TIn>, ...CascadeTier<M, TResult, TIn>[]]
  /** Optional budget constraints. */
  budget?: CascadeBudget
}

/** A cascade model wrapper — recognized by adapters via `isCascade()`. */
export interface CascadeModel<
  M = unknown,
  TBound = BoundOf<M>,
  TIn = InOf<M>,
>
  extends RoutingPhantom<
    TIn,
    ComposedCtx<object, M>,
    false,
    TBound,
    never
  > {
  readonly _tag: 'crux.cascade'
  readonly config: CascadeConfig<M>
}

/** Per-tier execution detail in cascade metadata. */
export interface CascadeTierDetail {
  model: string
  durationMs: number
  cost: number | undefined
  judgeCost?: number
  status: 'accepted' | 'rejected' | 'skipped'
  note?: string
  confidence?: number
  budget?: number
}

// ─────────────────────────────────────────────────────────────────
// cascade()
// ─────────────────────────────────────────────────────────────────

/**
 * Create a cascade model wrapper that tries tiers sequentially,
 * escalating when quality evaluation fails.
 *
 * @example
 * ```ts
 * import { cascade } from '@use-crux/core/routing'
 *
 * const smartCascade = cascade({
 *   tiers: [
 *     { model: haiku, evaluate: ({ result }) => result.quality > 0.8 },
 *     { model: sonnet, evaluate: ({ result }) => result.quality > 0.6 },
 *     { model: opus },
 *   ],
 *   budget: { maxCost: 0.05, maxLatencyMs: 5000 },
 * })
 *
 * generate(prompt, { model: smartCascade, input })
 * ```
 */
export function cascade<
  P extends AnyPrompt,
  const Ms extends readonly [unknown, ...unknown[]],
>(config: {
  readonly id?: string
  readonly description?: string
  readonly prompt: P
  readonly tiers: readonly [
    CascadeTier<Ms[number], PromptOutputOf<P>, PromptInputOf<P>>,
    ...CascadeTier<Ms[number], PromptOutputOf<P>, PromptInputOf<P>>[],
  ]
  readonly budget?: CascadeBudget
}): CascadeModel<Ms[number], P, PromptInputOf<P> | InOf<Ms[number]>>
export function cascade<const Ms extends readonly [unknown, ...unknown[]]>(config: {
  readonly id?: string
  readonly description?: string
  readonly tiers: readonly [
    CascadeTier<Ms[number], unknown, unknown>,
    ...CascadeTier<Ms[number], unknown, unknown>[],
  ]
  readonly budget?: CascadeBudget
}): CascadeModel<Ms[number], BoundOf<Ms[number]>, InOf<Ms[number]>>
export function cascade(config: {
  readonly id?: string
  readonly description?: string
  readonly prompt?: AnyPrompt
  readonly tiers: readonly [unknown, ...unknown[]]
  readonly budget?: CascadeBudget
}): unknown {
  return Object.freeze({
    _tag: 'crux.cascade' as const,
    config: config as CascadeConfig<unknown>,
    __phantom: undefined as unknown as CascadeModel<unknown, unknown, unknown>['__phantom'],
  })
}

// ─────────────────────────────────────────────────────────────────
// isCascade()
// ─────────────────────────────────────────────────────────────────

/** Type guard — returns `true` if the value is a `CascadeModel` wrapper. */
export function isCascade(model: unknown): model is CascadeModel {
  return (
    model !== null &&
    model !== undefined &&
    typeof model === 'object' &&
    '_tag' in model &&
    (model as { _tag: unknown })._tag === 'crux.cascade'
  )
}
