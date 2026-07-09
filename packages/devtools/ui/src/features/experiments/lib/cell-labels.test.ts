import { describe, expect, it } from 'vitest'
import type { QualityFeedbackRecord } from '@/types'
import { datasetProvenanceLine, latestCellLabel } from './cell-labels'

const label = (over: Partial<QualityFeedbackRecord>): QualityFeedbackRecord => ({
  _tag: 'QualityFeedback',
  id: 'f1',
  qualityId: 'local',
  createdAt: '2026-06-16T00:00:00.000Z',
  status: 'new',
  experimentId: '01KTA',
  caseId: 'c1',
  rating: 1,
  tags: ['human-label'],
  metadata: { variant: 'candidate', trial: 0 },
  ...over,
})

const cell = { experimentId: '01KTA', caseId: 'c1', variant: 'candidate', trial: 0 }

describe('latestCellLabel', () => {
  it('returns the newest human label matching the cell', () => {
    const older = label({ id: 'a', rating: -1, createdAt: '2026-06-16T00:00:00.000Z' })
    const newer = label({ id: 'b', rating: 1, createdAt: '2026-06-16T01:00:00.000Z' })
    const found = latestCellLabel([older, newer], cell)
    expect(found?.verdict).toBe('pass')
    expect(found?.at).toBe('2026-06-16T01:00:00.000Z')
  })

  it('maps a negative rating to a fail verdict', () => {
    expect(latestCellLabel([label({ rating: -1 })], cell)?.verdict).toBe('fail')
  })

  it('ignores non-human-label feedback and other cells', () => {
    expect(latestCellLabel([label({ tags: ['note'] })], cell)).toBeNull()
    expect(latestCellLabel([label({ caseId: 'other' })], cell)).toBeNull()
    expect(latestCellLabel([label({ metadata: { variant: 'default', trial: 0 } })], cell)).toBeNull()
    expect(latestCellLabel([label({ metadata: { variant: 'candidate', trial: 3 } })], cell)).toBeNull()
  })

  it('respects a scoreName filter when labeling a specific judge score', () => {
    const helpful = label({ metadata: { variant: 'candidate', trial: 0, scoreName: 'helpful' } })
    expect(latestCellLabel([helpful], { ...cell, scoreName: 'helpful' })?.verdict).toBe('pass')
    expect(latestCellLabel([helpful], { ...cell, scoreName: 'accurate' })).toBeNull()
  })
})

describe('datasetProvenanceLine', () => {
  it('renders path with a shortened fingerprint', () => {
    expect(
      datasetProvenanceLine({ path: 'datasets/refunds.jsonl', contentFingerprint: 'sha256:abcdef0123456789' }),
    ).toBe('datasets/refunds.jsonl @ sha256:abc…')
  })

  it('returns null when there is no provenance', () => {
    expect(datasetProvenanceLine(undefined)).toBeNull()
  })
})
