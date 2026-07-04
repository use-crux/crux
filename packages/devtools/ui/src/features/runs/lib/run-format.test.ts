import { describe, expect, it } from 'vitest'
import { formatGraphCounts, graphCountsTitle } from './run-format'
import type { RunRow } from '../types'

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
