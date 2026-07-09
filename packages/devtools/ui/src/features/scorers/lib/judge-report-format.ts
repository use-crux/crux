/**
 * Pure shaping for the JudgeReportPanel (blueprint §12.2): the 2×2 confusion
 * grid and rate formatting. Tested directly.
 */

import type { QualityJudgeReportScorer } from '@/types'

/** One labeled cell of the judge-vs-human confusion grid. */
export interface ConfusionGridCell {
  key: 'tp' | 'fp' | 'fn' | 'tn'
  label: string
  count: number
  agree: boolean
}

/** The 2×2 confusion grid in reading order: TP, FP, FN, TN. */
export function confusionGrid(confusion: QualityJudgeReportScorer['confusion']): ConfusionGridCell[] {
  return [
    { key: 'tp', label: 'Judge pass · Human pass', count: confusion.tp, agree: true },
    { key: 'fp', label: 'Judge pass · Human fail', count: confusion.fp, agree: false },
    { key: 'fn', label: 'Judge fail · Human pass', count: confusion.fn, agree: false },
    { key: 'tn', label: 'Judge fail · Human fail', count: confusion.tn, agree: true },
  ]
}

/** Format a 0–1 rate as a whole percentage, or `—` when undefined. */
export function formatRate(value: number | null | undefined): string {
  if (value == null) return '—'
  return `${Math.round(value * 100)}%`
}

/** Format Cohen's kappa to two decimals, or `—` when undefined. */
export function formatKappa(kappa: number | null | undefined): string {
  if (kappa == null) return '—'
  return kappa.toFixed(2)
}
