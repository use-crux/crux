import { describe, expect, it } from 'vitest'
import { deliveryHealthTone, formatGraphCounts, graphCountsTitle, hasReliabilityDetail, isLiveStatus, statusTone } from './run-format'
import type { RunRow } from '../types'

function row(overrides: Partial<RunRow> = {}): RunRow {
  return {
    kind: 'trace',
    id: 'run:r1',
    traceId: 'r1',
    target: 'r1',
    status: 'ok',
    startedAt: 0,
    feedbackCount: 0,
    ...overrides,
  }
}

describe('run format helpers', () => {
  it('formats observability graph rollups for compact table cells', () => {
    const run = {
      kind: 'trace',
      id: 'run:1',
      traceId: 'run:1',
      target: 'run',
      status: 'ok',
      startedAt: 1,
      feedbackCount: 0,
      recordCount: 100,
      spanCount: 7,
      eventCount: 42,
      artifactCount: 3,
      edgeCount: 2,
    } satisfies RunRow

    expect(formatGraphCounts(run)).toBe('7 / 42 / 3 / 2')
    expect(graphCountsTitle(run)).toBe('100 records · 7 spans · 42 events · 3 artifacts · 2 edges')
  })
})

describe('statusTone', () => {
  it('distinguishes suspended (non-terminal pause) from a terminal status', () => {
    expect(statusTone('suspended')).not.toBe(statusTone('ok'))
    expect(statusTone('suspended')).not.toBe(statusTone('error'))
  })

  it('distinguishes incomplete (telemetry gap) from error', () => {
    expect(statusTone('incomplete')).not.toBe(statusTone('error'))
  })

  it('flags conflicted as needing attention, distinct from a clean cancel', () => {
    expect(statusTone('conflicted')).toBe('danger')
    expect(statusTone('cancelled')).not.toBe('danger')
  })

  it('only running is "live" — suspended is not', () => {
    expect(isLiveStatus('running')).toBe(true)
    expect(isLiveStatus('suspended')).toBe(false)
    expect(isLiveStatus('incomplete')).toBe(false)
  })
})

describe('deliveryHealthTone', () => {
  it('treats unknown as distinct from healthy, not a synonym for it', () => {
    expect(deliveryHealthTone('unknown')).not.toBe(deliveryHealthTone('healthy'))
  })

  it('treats degraded as distinct from both unknown and healthy', () => {
    expect(deliveryHealthTone('degraded')).not.toBe(deliveryHealthTone('unknown'))
    expect(deliveryHealthTone('degraded')).not.toBe(deliveryHealthTone('healthy'))
  })

  it('falls back to muted when delivery health was never reported', () => {
    expect(deliveryHealthTone(undefined)).toBe('muted')
  })
})

describe('hasReliabilityDetail', () => {
  it('is calm for a normal single-segment run', () => {
    expect(hasReliabilityDetail(row({ segmentCount: 1, gapCount: 0, orderingConfidence: 'causal' }))).toBe(false)
  })

  it('flags a multi-segment run (suspend/resume across processes)', () => {
    expect(hasReliabilityDetail(row({ segmentCount: 2 }))).toBe(true)
  })

  it('flags sequence gaps and partial ordering', () => {
    expect(hasReliabilityDetail(row({ gapCount: 1 }))).toBe(true)
    expect(hasReliabilityDetail(row({ orderingConfidence: 'partial' }))).toBe(true)
  })

  it('flags a trace alias conflict and degraded delivery', () => {
    expect(hasReliabilityDetail(row({ traceAliasConflict: true }))).toBe(true)
    expect(hasReliabilityDetail(row({ deliveryHealth: 'degraded' }))).toBe(true)
  })

  it('stays calm when delivery health is merely unknown, not degraded', () => {
    expect(hasReliabilityDetail(row({ deliveryHealth: 'unknown' }))).toBe(false)
  })
})
