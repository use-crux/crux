import { describe, expect, it } from 'vitest'
import type { CruxGraphRecord } from '../../src/observability/contract'
import { collectTriggeredRunClosure } from '../../src/quality/internal/signals'

function edge(
  runId: string,
  toRunId: string,
): CruxGraphRecord {
  return {
    schemaVersion: 2,
    recordId: `rec-${runId}-${toRunId}`,
    type: 'edge',
    runId,
    segmentId: 'seg',
    segmentSeq: 1,
    edgeId: `edge-${runId}-${toRunId}`,
    edgeType: 'triggered',
    from: { kind: 'run', id: runId },
    to: { kind: 'run', id: toRunId },
    createdAt: new Date().toISOString(),
  } as CruxGraphRecord
}

function spanStart(runId: string, spanId: string, primitive: string): CruxGraphRecord {
  return {
    schemaVersion: 2,
    recordId: `rec-${spanId}`,
    type: 'span:start',
    runId,
    segmentId: 'seg',
    segmentSeq: 1,
    spanId,
    family: 'flow',
    primitive,
    name: spanId,
    startedAt: new Date().toISOString(),
    status: 'running',
  } as CruxGraphRecord
}

describe('collectTriggeredRunClosure', () => {
  it('includes the root run and transitively triggered child runs', () => {
    const byRun = new Map<string, CruxGraphRecord[]>([
      ['cell', [edge('cell', 'flow-a'), spanStart('cell', 'cell-root', 'eval.case')]],
      ['flow-a', [edge('flow-a', 'flow-b'), spanStart('flow-a', 'step-plan', 'flow.step')]],
      ['flow-b', [spanStart('flow-b', 'step-draft', 'flow.step')]],
      ['other-cell', [spanStart('other-cell', 'orphan', 'flow.step')]],
    ])

    const records = collectTriggeredRunClosure(byRun, 'cell')
    const runIds = new Set(records.map((r) => r.runId))
    expect(runIds).toEqual(new Set(['cell', 'flow-a', 'flow-b']))
    expect(records.some((r) => r.type === 'span:start' && (r as { spanId: string }).spanId === 'step-draft')).toBe(
      true,
    )
    expect(records.some((r) => r.runId === 'other-cell')).toBe(false)
  })

  it('returns only the root when no triggered edges exist', () => {
    const byRun = new Map<string, CruxGraphRecord[]>([
      ['only', [spanStart('only', 's1', 'eval.case')]],
    ])
    expect(collectTriggeredRunClosure(byRun, 'only')).toHaveLength(1)
    expect(collectTriggeredRunClosure(byRun, 'missing')).toEqual([])
  })
})
