import { describe, expect, it } from 'vitest'
import type { TurnDecisionReport } from '@/types'
import {
  aggregateRun,
  collectTurnEntries,
  collectTurnReports,
  warningTurnSpanIds,
  type ReportNode,
} from './rollup'

function report(id: string, over: Partial<TurnDecisionReport> = {}): TurnDecisionReport {
  return {
    schemaVersion: 1,
    reportId: `tdr:run:${id}`,
    runId: 'run',
    turn: { id, kind: 'generation.call', status: 'ok' },
    saw: [],
    considered: [],
    freshness: [],
    cache: [],
    decisions: [],
    source: [],
    coverage: { covered: 0, total: 0, areas: [] },
    gaps: [],
    ...over,
  }
}

describe('collectTurnReports', () => {
  it('walks the node tree and gathers every decisionReport, root first', () => {
    const tree: ReportNode = {
      decisionReport: report('root'),
      children: [
        { decisionReport: report('a'), children: [] },
        { children: [{ decisionReport: report('b'), children: [] }] },
      ],
    }
    expect(collectTurnReports(tree).map((r) => r.turn.id)).toEqual(['root', 'a', 'b'])
  })

  it('returns an empty list when no node carries a report', () => {
    expect(collectTurnReports({ children: [{ children: [] }] })).toEqual([])
  })
})

describe('collectTurnEntries', () => {
  it('pairs each report with the node id that carries it', () => {
    const tree: ReportNode = {
      id: 'root',
      children: [
        { id: 'gen-1', decisionReport: report('a'), children: [] },
        { id: 'no-id-no-report', children: [{ id: 'gen-2', decisionReport: report('b'), children: [] }] },
      ],
    }
    expect(collectTurnEntries(tree)).toEqual([
      { id: 'gen-1', report: report('a') },
      { id: 'gen-2', report: report('b') },
    ])
  })
})

describe('warningTurnSpanIds', () => {
  it('collects ids of nodes whose turn carries a warning signal', () => {
    const tree: ReportNode = {
      id: 'root',
      decisionReport: report('root', { turn: { id: 'root', kind: 'generation.call', status: 'ok' } }),
      children: [
        { id: 'warn', decisionReport: report('warn', { turn: { id: 'warn', kind: 'generation.call', status: 'error' } }), children: [] },
        { id: 'clean', decisionReport: report('clean'), children: [] },
        { id: 'noreport', children: [] },
      ],
    }
    const ids = warningTurnSpanIds(tree)
    expect(ids.has('warn')).toBe(true)
    expect(ids.has('clean')).toBe(false)
    expect(ids.has('root')).toBe(false)
    expect(ids.has('noreport')).toBe(false)
  })
})

describe('aggregateRun', () => {
  it('counts turns, attention, drops, stale-used, fallback and coverage', () => {
    const reports = [
      report('clean', { coverage: { covered: 3, total: 3, areas: [] } }),
      report('warn', {
        turn: { id: 'warn', kind: 'generation.call', status: 'warn' },
        considered: [
          { kind: 'context', disposition: 'dropped', evidenceLevel: 'declared', sourceStatus: 'dropped' },
          { kind: 'context', disposition: 'dropped', evidenceLevel: 'declared', sourceStatus: 'dropped' },
        ],
        freshness: [{ subject: { kind: 'tool' }, status: 'stale-used' }],
        decisions: [
          {
            id: 'd',
            phase: 'recovery',
            kind: 'routing',
            subject: { kind: 'route' },
            outcome: 'tier 2',
            reason: { code: 'routing.fallback.fired', text: 'x', source: 'artifact', evidenceLevel: 'declared' },
          },
        ],
        coverage: { covered: 1, total: 3, areas: [] },
      }),
    ]
    const agg = aggregateRun(reports)
    expect(agg.turns).toBe(2)
    expect(agg.needAttention).toBe(1)
    expect(agg.dropped).toBe(2)
    expect(agg.staleUsed).toBe(1)
    expect(agg.fallback).toBe(1)
    expect(agg.covered).toBe(4)
    expect(agg.total).toBe(6)
  })

  it('is all-zero for an empty run', () => {
    expect(aggregateRun([])).toEqual({
      turns: 0,
      needAttention: 0,
      dropped: 0,
      staleUsed: 0,
      fallback: 0,
      covered: 0,
      total: 0,
    })
  })
})
