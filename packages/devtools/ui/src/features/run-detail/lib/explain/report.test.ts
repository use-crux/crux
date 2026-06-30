import { describe, expect, it } from 'vitest'
import type { TurnDecisionReport } from '@/types'
import { normalizeTurnDecisionReport, type RuntimeTurnDecisionReport } from './report'

describe('normalizeTurnDecisionReport', () => {
  it('keeps a partial live report renderable when collection fields arrive as null', () => {
    const report = {
      schemaVersion: 1,
      reportId: 'tdr:run:gen',
      runId: 'run',
      turn: { id: 'gen', kind: 'generation.call', status: 'ok' },
      saw: [],
      considered: null,
      freshness: [],
      cache: null,
      decisions: [],
      source: [{ group: 'Contexts', items: null }],
      coverage: { covered: 0, total: 6, areas: null },
      gaps: null,
      summary: null,
    } satisfies RuntimeTurnDecisionReport

    const normalized = normalizeTurnDecisionReport(report)

    expect(normalized).toMatchObject({
      considered: [],
      cache: [],
      gaps: [],
      coverage: { covered: 0, total: 6, areas: [] },
    })
    expect(normalized?.source[0]?.items).toEqual([])
    expect(normalized?.summary).toBeUndefined()
  })

  it('passes through valid report arrays without changing the contract shape', () => {
    const report: TurnDecisionReport = {
      schemaVersion: 1,
      reportId: 'tdr:run:gen',
      runId: 'run',
      turn: { id: 'gen', kind: 'generation.call', status: 'error' },
      saw: [{ kind: 'prompt', disposition: 'active', evidenceLevel: 'declared', sourceStatus: 'used' }],
      considered: [],
      freshness: [],
      cache: [],
      decisions: [],
      source: [],
      coverage: { covered: 6, total: 6, areas: [] },
      gaps: [],
    }

    expect(normalizeTurnDecisionReport(report)).toEqual(report)
  })
})
