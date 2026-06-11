/**
 * Sequential quality escalation — tries cheap models first,
 * escalates to expensive models when quality evaluation fails.
 *
 * @module
 */

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

/** Evaluation context passed to each tier's evaluate function. */
export interface CascadeTierContext {
  /** The model ID that produced this result. */
  model: string
  /** Cost of this tier's generation (undefined if provider doesn't report it). */
  cost: number | undefined
  /** 0-based index of this tier. */
  tierIndex: number
  /** Cumulative cost across all tiers so far (including this one). */
  totalCost: number
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

/** A single tier in a cascade. */
export interface CascadeTier<M> {
  /** The model (or model wrapper like fallback) for this tier. */
  model: M
  /** Optional threshold/budget label to include in observability reports. */
  budget?: number
  /** Optional static note to include in observability reports. */
  note?: string
  /**
   * Evaluate the result. Return true to accept, false to try next tier, or a
   * structured result to include confidence/note/budget in observability.
   */
  evaluate?: (
    result: unknown,
    context: CascadeTierContext,
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
export interface CascadeConfig<M> {
  /** Stable id used to join authored index definitions with routing spans. */
  id?: string
  /** Human-readable description for index and devtools surfaces. */
  description?: string
  /** Tiers to try in order. At least one required. */
  tiers: [CascadeTier<M>, ...CascadeTier<M>[]]
  /** Optional budget constraints. */
  budget?: CascadeBudget
}

/** A cascade model wrapper — recognized by adapters via `isCascade()`. */
export interface CascadeModel<M = unknown> {
  readonly _tag: 'crux.cascade'
  readonly config: CascadeConfig<M>
}

/** Per-tier execution detail in cascade metadata. */
export interface CascadeTierDetail {
  model: string
  durationMs: number
  cost: number | undefined
  status: 'accepted' | 'rejected' | 'skipped'
  note?: string
  confidence?: number
  budget?: number
}

/** Metadata attached to `_meta.cascade` on cascade results. */
export interface CascadeMeta {
  tiersAttempted: number
  totalTiers: number
  acceptedAtTier: number
  budgetExceeded: boolean
  tiers: CascadeTierDetail[]
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
 * import { cascade } from '@crux/core/routing'
 *
 * const smartCascade = cascade({
 *   tiers: [
 *     { model: haiku, evaluate: (r) => r.object.quality > 0.8 },
 *     { model: sonnet, evaluate: (r) => r.object.quality > 0.6 },
 *     { model: opus },
 *   ],
 *   budget: { maxCost: 0.05, maxLatencyMs: 5000 },
 * })
 *
 * generate(prompt, { model: smartCascade, input })
 * ```
 */
export function cascade<M>(config: CascadeConfig<M>): CascadeModel<M> {
  return Object.freeze({
    _tag: 'crux.cascade' as const,
    config,
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
