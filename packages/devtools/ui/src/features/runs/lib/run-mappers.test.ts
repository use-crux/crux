import { describe, expect, it } from 'vitest'
import { buildRunsQuery } from '@/shared/services/quality'
import type { QualityRunRecord } from '@/types'
import { groupRuns } from './run-groups'
import type { RunRow } from '../types'
import {
  enrichRunRowFromObservability,
  qualityOptionsFromFilters,
  rowFromObservabilityRun,
  rowFromQualityRun,
} from './run-mappers'

describe('runs row mapping', () => {
  it('maps deferred-work root primitives to the defer kind', async () => {
    const { canonicalPrimitiveKind } = await import('./run-mappers')
    expect(canonicalPrimitiveKind('defer.scheduled')).toBe('defer')
    expect(canonicalPrimitiveKind('defer.run')).toBe('defer')
  })

  it('uses observability list rollups and root session ids directly', () => {
    const run = {
      runId: 'run_live',
      traceId: 'trace_live',
      name: 'streaming answer',
      rootPrimitive: 'generation.call',
      status: 'running',
      startedAt: '2026-07-03T10:00:00.000Z',
      endedAt: '',
      durationMs: 1234,
      model: 'openai/gpt-4.1',
      provider: 'openai',
      promptId: 'support.reply',
      sessionId: 'session_root',
      recordCount: 100,
      spanCount: 7,
      eventCount: 42,
      artifactCount: 3,
      edgeCount: 2,
      metrics: {
        totalTokens: 987,
        costUsd: 0.0123,
      },
      attributes: {
        sessionId: 'stale_attribute_session',
      },
    }

    expect(rowFromObservabilityRun(run)).toMatchObject({
      traceId: 'run_live',
      sessionId: 'session_root',
      tokenCount: 987,
      cost: 0.0123,
      recordCount: 100,
      spanCount: 7,
      eventCount: 42,
      artifactCount: 3,
      edgeCount: 2,
      childCount: 7,
    })
  })

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

  it('enriches quality rows with observability session and rollup fields', () => {
    const qualityRow = runRow('run_enriched', 100, undefined)
    const observabilityRun = {
      runId: 'run_enriched',
      traceId: 'trace_enriched',
      name: 'enriched',
      rootPrimitive: 'generation.call',
      status: 'ok',
      startedAt: '2026-07-03T10:00:00.000Z',
      endedAt: '2026-07-03T10:00:01.000Z',
      durationMs: 1000,
      model: 'openai/gpt-4.1',
      provider: 'openai',
      promptId: 'prompt',
      sessionId: 'session_enriched',
      recordCount: 9,
      spanCount: 2,
      eventCount: 3,
      artifactCount: 4,
      edgeCount: 5,
      metrics: { totalTokens: 123, costUsd: 0.045 },
    }

    expect(enrichRunRowFromObservability(qualityRow, observabilityRun)).toMatchObject({
      sessionId: 'session_enriched',
      tokenCount: 123,
      cost: 0.045,
      recordCount: 9,
      spanCount: 2,
      eventCount: 3,
      artifactCount: 4,
      edgeCount: 5,
      childCount: 2,
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

  it('groups sessions newest first and keeps newest runs first inside each session', () => {
    const rows = [
      runRow('old-a', 100, 'session-a'),
      runRow('new-b', 500, 'session-b'),
      runRow('new-a', 900, 'session-a'),
      runRow('old-b', 200, 'session-b'),
      runRow('ungrouped', 700, undefined),
    ]

    const groups = groupRuns(rows, 'session')

    expect(groups.map((group) => group.key)).toEqual(['session-a', '-', 'session-b'])
    expect(groups[0]!.rows.map((run) => run.traceId)).toEqual(['new-a', 'old-a'])
    expect(groups[2]!.rows.map((run) => run.traceId)).toEqual(['new-b', 'old-b'])
  })
})

function runRow(traceId: string, startedAt: number, sessionId: string | undefined): RunRow {
  return {
    kind: 'trace',
    id: `run:${traceId}`,
    traceId,
    target: traceId,
    sessionId,
    status: 'ok',
    startedAt,
    feedbackCount: 0,
  }
}
