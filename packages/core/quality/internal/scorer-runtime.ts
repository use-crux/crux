/**
 * Scorer runtime channel — how the engine hands ambient providers to
 * model-backed built-in scorers without changing the autoevals-compatible
 * call signature.
 *
 * Built-in model-backed scorers (`judge`, `embeddingSimilarity`, `rag.*`)
 * carry a contextual run function under {@link SCORER_INTERNAL} alongside the
 * plain callable. The engine invokes that form with the per-cell
 * {@link ScorerRunContext}; a plain `scorer(args)` call (autoevals path,
 * standalone usage) delegates with `context: undefined`, where model-backed
 * scorers throw a setup-pointing error.
 *
 * This is a symbol channel rather than AsyncLocalStorage so per-cell context
 * (signals) stays race-free under concurrent cells and the public scorer
 * module needs no Node-only imports.
 *
 * @internal
 * @module
 */

import type { Score, Scorer, ScorerArgs, EmbedFn } from '../scorers'
import type { GenerateFn } from '../target'
import type { CellSignals } from './signals'

/** Storage key for a built-in scorer's contextual run function. @internal */
export const SCORER_INTERNAL: unique symbol = Symbol('crux.quality.scorer')

/**
 * Ambient providers + per-cell facts the engine hands to model-backed
 * scorers. `generate`/`model`/`models`/`judgeModel`/`embed` come from
 * the evaluation runner; `signals` are the executing cell's captured trace
 * signals (rag scorers read retrieved context from them).
 *
 * @internal
 */
export interface ScorerRunContext {
  generate?: GenerateFn
  model?: unknown
  models?: Record<string, unknown>
  judgeModel?: unknown
  embed?: EmbedFn
  signals?: CellSignals
}

/** The contextual run form of a built-in scorer. @internal */
export type ContextualScorerRun = (
  args: ScorerArgs<unknown, unknown, unknown>,
  context: ScorerRunContext | undefined,
) => Score | Promise<Score>

/** A scorer that may carry the contextual run form. @internal */
type MaybeContextualScorer = Scorer<unknown, unknown, unknown, string> & {
  [SCORER_INTERNAL]?: ContextualScorerRun
}

/**
 * Invoke a scorer the way the engine does: through the contextual run form
 * when the scorer carries one (built-in model-backed scorers), else as a
 * plain autoevals-compatible call.
 *
 * @internal
 */
export function invokeScorer(
  scorer: Scorer<unknown, unknown, unknown, string>,
  args: ScorerArgs<unknown, unknown, unknown>,
  context: ScorerRunContext | undefined,
): Score | Promise<Score> {
  const contextual = (scorer as MaybeContextualScorer)[SCORER_INTERNAL]
  if (contextual !== undefined) return contextual(args, context)
  return scorer(args)
}

/**
 * Resolve a judge/task model reference against the setup's named models:
 * string refs that name an entry in `models` resolve to it; everything else
 * passes through.
 *
 * @internal
 */
export function resolveModelRef(ref: unknown, context: ScorerRunContext | undefined): unknown {
  if (typeof ref === 'string' && context?.models !== undefined && ref in context.models) {
    return context.models[ref]
  }
  return ref
}
