/**
 *
 * Runtime score-map helpers for post-score Eval assertions.
 *
 * Public typing decides which keys are statically visible on `ctx.score`.
 * Runtime still builds the map from all numeric cell scores so dynamic names
 * can be inspected through `ctx.scores` and, when known by string, read from
 * the erased map without changing the public type contract.
 *
 * @internal Eval engine plumbing only.
 * @module
 */

import type { Score } from '../scorers/types'

/** Erased runtime form backing the public `ScoreMap<TName>` type. */
export type RuntimeScoreMap = Readonly<Record<string, number>>

/**
 * Build the post-score assertion map from completed cell scores.
 *
 * Skipped scores (`score: null`) remain visible in `ctx.scores` but are not
 * inserted into `ctx.score`, which is reserved for numeric threshold checks.
 */
export function scoreMapFromScores(scores: readonly Score[]): RuntimeScoreMap {
  const map: Record<string, number> = {}
  for (const score of scores) {
    if (score.score !== null) map[score.name] = score.score
  }
  return Object.freeze(map)
}
