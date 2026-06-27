/**
 * Evaluation selection helpers for the Quality worker.
 *
 * This module keeps id filtering and nearest-match diagnostics separate from
 * execution orchestration so the runner can stay focused on event flow.
 *
 * @module
 */

import type { CollectedEvaluation } from './quality-collect'

/** Result of applying optional CLI evaluation id filters. */
export interface QualityEvaluationSelection {
  /** Selected evaluations in CLI order, or all collected evaluations when no ids were provided. */
  selected: CollectedEvaluation[]
  /** The first unknown id, when selection failed. */
  unknownId?: string
}

/** Select evaluations by id, preserving requested order and failing on the first unknown id. */
export function selectEvaluations(
  collected: readonly CollectedEvaluation[],
  ids: readonly string[] | undefined,
): QualityEvaluationSelection {
  if (ids === undefined || ids.length === 0) return { selected: [...collected] }
  const byId = new Map(collected.map((entry) => [entry.id, entry]))
  const selected: CollectedEvaluation[] = []
  for (const id of ids) {
    const entry = byId.get(id)
    if (entry === undefined) return { selected: [], unknownId: id }
    selected.push(entry)
  }
  return { selected }
}

/** Render a stable unknown-id diagnostic with a typo hint when one is plausible. */
export function unknownIdMessage(unknownId: string, collected: readonly CollectedEvaluation[]): string {
  const nearest = nearestMatch(
    unknownId,
    collected.map((entry) => entry.id),
  )
  const hint = nearest === undefined ? '' : ` Did you mean '${nearest}'?`
  return `Unknown evaluation id '${unknownId}'.${hint}`
}

function nearestMatch(needle: string, candidates: readonly string[]): string | undefined {
  let best: string | undefined
  let bestDistance = Number.POSITIVE_INFINITY
  for (const candidate of candidates) {
    const distance = levenshtein(needle, candidate)
    if (distance < bestDistance) {
      bestDistance = distance
      best = candidate
    }
  }
  // Only suggest plausible typos, not arbitrary ids.
  return bestDistance <= Math.max(3, Math.floor(needle.length / 3)) ? best : undefined
}

function levenshtein(a: string, b: string): number {
  const previous = new Array<number>(b.length + 1)
  for (let j = 0; j <= b.length; j++) previous[j] = j
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0]!
    previous[0] = i
    for (let j = 1; j <= b.length; j++) {
      const insertOrDelete = Math.min(previous[j]!, previous[j - 1]!) + 1
      const substitute = diagonal + (a[i - 1] === b[j - 1] ? 0 : 1)
      diagonal = previous[j]!
      previous[j] = Math.min(insertOrDelete, substitute)
    }
  }
  return previous[b.length]!
}
