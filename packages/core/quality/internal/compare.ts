/**
 * Paired-difference comparison statistics (direction doc §7, spec 02 §1).
 *
 * Comparisons are computed as question-level paired differences (the
 * Anthropic error-bars method): per case, trials are averaged first; then
 * candidate − baseline differences are taken per matched case, and the mean
 * delta is reported with the SEM of those paired differences. Cases present
 * on only one side are excluded from the pairing and listed honestly.
 *
 * @internal Not exported from `@crux/core/quality` — engine plumbing only.
 * @module
 */

import type { Comparison, ComparisonDelta, ExperimentCell } from '../experiment'

/** caseId → scoreName → mean score (trials averaged, null scores skipped). */
export type CaseScoreMeans = ReadonlyMap<string, ReadonlyMap<string, number>>

/**
 * Collapse one variant's cells into per-case mean scores. Trials are averaged
 * per case BEFORE any pairing (spec 02 §1 semantics note); `null` scores
 * (scorer skipped) contribute nothing.
 *
 * @internal
 */
export function caseScoreMeans(cells: readonly ExperimentCell<unknown, unknown>[]): CaseScoreMeans {
  const sums = new Map<string, Map<string, { total: number; count: number }>>()
  for (const cell of cells) {
    if (cell.status === 'skipped') continue
    let perScore = sums.get(cell.caseId)
    if (perScore === undefined) {
      perScore = new Map()
      sums.set(cell.caseId, perScore)
    }
    for (const score of cell.scores) {
      if (score.score === null) continue
      const bucket = perScore.get(score.name)
      if (bucket === undefined) perScore.set(score.name, { total: score.score, count: 1 })
      else {
        bucket.total += score.score
        bucket.count += 1
      }
    }
  }
  const means = new Map<string, Map<string, number>>()
  for (const [caseId, perScore] of sums) {
    const caseMeans = new Map<string, number>()
    for (const [name, { total, count }] of perScore) caseMeans.set(name, total / count)
    means.set(caseId, caseMeans)
  }
  return means
}

function meanOf(values: readonly number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function semOf(values: readonly number[]): number {
  if (values.length < 2) return 0
  const mean = meanOf(values)
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance / values.length)
}

/** Paired deltas of one candidate against a baseline's per-case means. @internal */
function deltasAgainst(input: {
  variantName: string
  baseline: CaseScoreMeans
  candidate: CaseScoreMeans
}): ComparisonDelta<string>[] {
  const diffs = new Map<string, number[]>()
  for (const [caseId, candidateScores] of input.candidate) {
    const baselineScores = input.baseline.get(caseId)
    if (baselineScores === undefined) continue
    for (const [name, candidateMean] of candidateScores) {
      const baselineMean = baselineScores.get(name)
      if (baselineMean === undefined) continue
      const bucket = diffs.get(name)
      const diff = candidateMean - baselineMean
      if (bucket === undefined) diffs.set(name, [diff])
      else bucket.push(diff)
    }
  }
  const deltas: ComparisonDelta<string>[] = []
  for (const [scoreName, values] of diffs) {
    deltas.push({
      variantName: input.variantName,
      scoreName,
      meanDelta: meanOf(values),
      sem: semOf(values),
      n: values.length,
    })
  }
  return deltas.sort((a, b) => a.scoreName.localeCompare(b.scoreName))
}

function unmatchedBetween(
  baseline: CaseScoreMeans,
  candidates: readonly CaseScoreMeans[],
): { baselineOnly: string[]; candidateOnly: string[] } {
  const candidateCaseIds = new Set<string>()
  for (const candidate of candidates) for (const caseId of candidate.keys()) candidateCaseIds.add(caseId)
  const baselineOnly = [...baseline.keys()].filter((caseId) => !candidateCaseIds.has(caseId)).sort()
  const candidateOnly = [...candidateCaseIds].filter((caseId) => !baseline.has(caseId)).sort()
  return { baselineOnly, candidateOnly }
}

/**
 * Compare candidate variants against the declared baseline variant within
 * one run (`Comparison.kind: 'variant'`).
 *
 * @internal
 */
export function compareVariants(input: {
  cells: readonly ExperimentCell<unknown, unknown>[]
  baselineName: string
  candidateNames: readonly string[]
}): Comparison<string> {
  const byVariant = new Map<string, ExperimentCell<unknown, unknown>[]>()
  for (const cell of input.cells) {
    const bucket = byVariant.get(cell.variantName)
    if (bucket === undefined) byVariant.set(cell.variantName, [cell])
    else bucket.push(cell)
  }
  const baselineMeans = caseScoreMeans(byVariant.get(input.baselineName) ?? [])
  const deltas: ComparisonDelta<string>[] = []
  const candidateMeans: CaseScoreMeans[] = []
  for (const name of input.candidateNames) {
    const means = caseScoreMeans(byVariant.get(name) ?? [])
    candidateMeans.push(means)
    deltas.push(...deltasAgainst({ variantName: name, baseline: baselineMeans, candidate: means }))
  }
  return {
    kind: 'variant',
    baseline: input.baselineName,
    deltas,
    unmatchedCases: unmatchedBetween(baselineMeans, candidateMeans),
  }
}

/**
 * Compare every variant of the current run against a promoted baseline's
 * frozen per-case reference values (`Comparison.kind: 'promoted'`).
 *
 * @internal
 */
export function comparePromoted(input: {
  cells: readonly ExperimentCell<unknown, unknown>[]
  variantNames: readonly string[]
  /** BaselineRecord.reference — caseId → score name → mean. */
  reference: Readonly<Record<string, Readonly<Record<string, number>>>>
  /** The promoted experiment id (the `Comparison.baseline` value). */
  baselineExperimentId: string
}): Comparison<string> {
  const referenceMeans = new Map<string, Map<string, number>>()
  for (const [caseId, scores] of Object.entries(input.reference)) {
    referenceMeans.set(caseId, new Map(Object.entries(scores)))
  }
  const byVariant = new Map<string, ExperimentCell<unknown, unknown>[]>()
  for (const cell of input.cells) {
    const bucket = byVariant.get(cell.variantName)
    if (bucket === undefined) byVariant.set(cell.variantName, [cell])
    else bucket.push(cell)
  }
  const deltas: ComparisonDelta<string>[] = []
  const candidateMeans: CaseScoreMeans[] = []
  for (const name of input.variantNames) {
    const means = caseScoreMeans(byVariant.get(name) ?? [])
    candidateMeans.push(means)
    deltas.push(...deltasAgainst({ variantName: name, baseline: referenceMeans, candidate: means }))
  }
  return {
    kind: 'promoted',
    baseline: input.baselineExperimentId,
    deltas,
    unmatchedCases: unmatchedBetween(referenceMeans, candidateMeans),
  }
}
