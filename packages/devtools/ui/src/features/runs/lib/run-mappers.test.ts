import { describe, expect, it } from 'vitest'
import { buildRunsQuery } from '@/shared/services/quality'
import type { QualityRunRecord } from '@/types'
import { qualityOptionsFromFilters, rowFromQualityRun } from './run-mappers'

describe('runs row mapping', () => {
  it('uses backend-owned run row rollups when present', () => {
    const run = {
      _tag: 'QualityRun',
      traceId: 'run-1',
      targetId: 'support reply',
      rootPrimitive: 'generation.call',
      kind: 'generation',
      status: 'ok',
      startedAt: 1_775_000_000_000,
      model: 'gpt-4o',
      provider: 'openai',
      tokenCount: 42,
      toolCallCount: 2,
      spanCount: 3,
      childCount: 3,
      feedbackCount: 1,
      feedbackIds: ['feedback-1'],
      experimentIds: [],
      diagnosticsCount: 2,
      diagnosticsMaxSeverity: 'warn',
    } satisfies QualityRunRecord

    expect(rowFromQualityRun(run)).toMatchObject({
      kind: 'generate',
      traceId: 'run-1',
      status: 'ok',
      feedbackCount: 1,
      childCount: 3,
      diagnosticsCount: 2,
      diagnosticsMaxSeverity: 'warn',
    })
  })

  it('forwards run list filters to the backend query shape', () => {
    const opts = qualityOptionsFromFilters({
      status: ['ok'],
      target: ['support reply'],
      model: ['gpt-4o'],
      has: 'feedback',
      last: 'all',
    })

    expect(buildRunsQuery(opts)).toBe('?status=ok&target=support+reply&model=gpt-4o&has=feedback&sort=time&order=desc')
  })
})
