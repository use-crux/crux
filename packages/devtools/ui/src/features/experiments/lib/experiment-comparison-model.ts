import type {
  QualityBaselineRecord,
  QualityExperimentComparison,
  QualityExperimentDetail,
} from '@/types'

export interface ComparisonSides {
  /** Label/name for the baseline side: a variant name for in-run comparisons, an experiment id for promoted baselines. */
  readonly base: string
  /** Variant name for the candidate side, when one can be inferred from variants or comparison deltas. */
  readonly candidate: string | null
}

export interface BaselineReferenceAggregate {
  readonly caseCount: number
  readonly passRate: number | null
  readonly scores: Readonly<Record<string, { readonly mean: number; readonly sem: number; readonly n: number }>>
}

/**
 * Resolve the two semantic sides of an experiment comparison.
 *
 * Variant bakeoffs store both sides as variants in the same experiment. Promoted
 * baseline comparisons store the baseline as an experiment id and keep only the
 * candidate variant in the current run, so the candidate must be read from the
 * comparison deltas before falling back to the variant list.
 */
export function comparisonSides(exp: QualityExperimentDetail): ComparisonSides {
  const base = exp.comparison?.baseline ?? exp.baselineRef?.variantName ?? exp.variants[0]?.name ?? ''
  const fromDelta = exp.comparison?.deltas.find((delta) => delta.variantName !== base)?.variantName
  const candidate = fromDelta ?? exp.variants.map((variant) => variant.name).find((name) => name !== base) ?? null
  return { base, candidate }
}

/** Score names shown in the rollup, including promoted-baseline reference scores when present. */
export function collectRollupScoreNames(
  exp: QualityExperimentDetail,
  baselineReference?: QualityBaselineRecord | null,
): string[] {
  const names = new Set<string>()
  for (const variant of exp.variants) {
    const aggregate = exp.aggregates.perVariant[variant.name]
    if (aggregate) for (const name of Object.keys(aggregate.scores)) names.add(name)
  }
  if (baselineReference) {
    for (const caseScores of Object.values(baselineReference.reference)) {
      for (const name of Object.keys(caseScores)) names.add(name)
    }
  }
  return [...names]
}

/** Score deltas for the inferred candidate side, preserving SEM for noise-aware UI copy. */
export function candidateDeltas(
  comparison: QualityExperimentComparison | undefined,
  candidate: string | null,
): readonly QualityExperimentComparison['deltas'][number][] {
  if (!comparison || !candidate) return []
  return comparison.deltas.filter((delta) => delta.variantName === candidate)
}

/** Score names where the candidate moved beyond its error bar. */
export function realDeltas(
  comparison: QualityExperimentComparison | undefined,
  candidate: string | null,
): Map<string, { delta: number; sem: number }> {
  const out = new Map<string, { delta: number; sem: number }>()
  for (const delta of candidateDeltas(comparison, candidate)) {
    if (Math.abs(delta.meanDelta) > delta.sem) out.set(delta.scoreName, { delta: delta.meanDelta, sem: delta.sem })
  }
  return out
}

/** Whether the hero should show a side panel for comparison movement. */
export function shouldShowComparisonPanel(input: {
  readonly comparison: QualityExperimentComparison | undefined
  readonly hasCostTradeoff: boolean
  readonly hasLatencyTradeoff: boolean
  readonly candidateDeltaCount: number
}): boolean {
  return Boolean(input.comparison && (input.hasCostTradeoff || input.hasLatencyTradeoff || input.candidateDeltaCount > 0))
}

/**
 * Aggregate a promoted baseline's frozen reference scores for display.
 *
 * Baseline records intentionally retain score references, not full cells. That
 * means this view model can show score means and a pass-rate estimate when the
 * lowered `pass` score exists, while leaving latency/cost to real experiment
 * aggregates.
 */
export function aggregateBaselineReference(reference: QualityBaselineRecord['reference']): BaselineReferenceAggregate {
  const valuesByName = new Map<string, number[]>()
  const cases = Object.values(reference)

  for (const caseScores of cases) {
    for (const [name, value] of Object.entries(caseScores)) {
      const values = valuesByName.get(name) ?? []
      values.push(value)
      valuesByName.set(name, values)
    }
  }

  const scores: Record<string, { mean: number; sem: number; n: number }> = {}
  for (const [name, values] of valuesByName) {
    const n = values.length
    const mean = n === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / n
    const variance =
      n <= 1 ? 0 : values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / (n - 1)
    scores[name] = { mean, sem: Math.sqrt(variance) / Math.sqrt(Math.max(1, n)), n }
  }

  return {
    caseCount: cases.length,
    passRate: scores.pass?.mean ?? null,
    scores,
  }
}
