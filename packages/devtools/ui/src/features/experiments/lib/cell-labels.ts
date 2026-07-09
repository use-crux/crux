/**
 * Cell-label + provenance helpers for the CellEvidence failure panel and
 * labeling affordance (blueprint §12.1/§12.4). Pure, so unit-tested directly.
 */

import type { QualityFailureArtifact, QualityFeedbackRecord } from '@/types'

/** Identity of the cell (and optional judge score) a label adjudicates. */
export interface CellLabelTarget {
  experimentId: string
  caseId: string
  variant: string
  trial: number
  /** Present when labeling a specific judge score row rather than the cell. */
  scoreName?: string
}

/** A resolved human label on a cell. */
export interface CellLabel {
  verdict: 'pass' | 'fail'
  at: string
  note?: string
}

const HUMAN_LABEL_TAG = 'human-label'

/**
 * The most recent human label on a cell (newest `createdAt` wins). A label
 * matches when it is tagged `human-label`, targets the same experiment/case,
 * and its metadata variant+trial match — plus scoreName when the caller is
 * labeling a specific judge score.
 */
export function latestCellLabel(
  feedback: readonly QualityFeedbackRecord[] | null | undefined,
  target: CellLabelTarget,
): CellLabel | null {
  if (!feedback) return null
  let best: QualityFeedbackRecord | undefined
  for (const record of feedback) {
    if (!record.tags?.includes(HUMAN_LABEL_TAG)) continue
    if (record.experimentId !== target.experimentId || record.caseId !== target.caseId) continue
    if (record.rating == null) continue
    const meta = record.metadata ?? {}
    if (meta.variant !== target.variant || meta.trial !== target.trial) continue
    if (target.scoreName != null && meta.scoreName !== target.scoreName) continue
    if (!best || record.createdAt > best.createdAt) best = record
  }
  if (!best) return null
  return {
    verdict: (best.rating ?? 0) > 0 ? 'pass' : 'fail',
    at: best.createdAt,
    note: best.comment,
  }
}

/** `path @ fingerprint-short` line for a dataset-backed cell, or null. */
export function datasetProvenanceLine(
  provenance: QualityFailureArtifact['datasetProvenance'] | undefined,
): string | null {
  if (!provenance) return null
  const fp = provenance.contentFingerprint
  const short = fp.length > 10 ? `${fp.slice(0, 10)}…` : fp
  return `${provenance.path} @ ${short}`
}
