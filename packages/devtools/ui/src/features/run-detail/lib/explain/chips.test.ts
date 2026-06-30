import { describe, expect, it } from 'vitest'
import type { TurnDecisionReport } from '@/types'
import { summaryChips, warningChips } from './chips'

function baseReport(): TurnDecisionReport {
  return {
    schemaVersion: 1,
    reportId: 'tdr:run:gen',
    runId: 'run',
    turn: { id: 'gen', kind: 'generation.call', status: 'warn' },
    saw: [
      { kind: 'prompt', disposition: 'active', evidenceLevel: 'declared', sourceStatus: 'used' },
      { kind: 'context', disposition: 'active', evidenceLevel: 'declared', sourceStatus: 'used' },
    ],
    considered: [
      {
        kind: 'context',
        disposition: 'checked',
        evidenceLevel: 'declared',
        sourceStatus: 'checked',
      },
      {
        kind: 'context',
        disposition: 'dropped',
        required: true,
        evidenceLevel: 'declared',
        sourceStatus: 'dropped',
      },
    ],
    freshness: [{ subject: { kind: 'tool' }, status: 'stale-used' }],
    cache: [{ subject: { kind: 'context' }, status: 'hit' }],
    decisions: [
      {
        id: 'd',
        phase: 'recovery',
        kind: 'routing',
        subject: { kind: 'route', name: 'fallback' },
        outcome: 'tier 2',
        reason: { code: 'routing.fallback.fired', text: 'x', source: 'artifact', evidenceLevel: 'declared' },
      },
    ],
    source: [],
    coverage: { covered: 2, total: 6, areas: [] },
    gaps: [],
  }
}

describe('summaryChips (derived when the backend emits none)', () => {
  const chips = summaryChips(baseReport())
  const byId = (id: string) => chips.find((c) => c.id === id)

  it('counts what the model saw', () => {
    expect(byId('saw')?.value).toBe(2)
    expect(byId('saw')?.jump).toBe('saw')
  })

  it('flags dropped items as danger and points at the considered section', () => {
    expect(byId('dropped')?.value).toBe(1)
    expect(byId('dropped')?.tone).toBe('danger')
    expect(byId('dropped')?.jump).toBe('considered')
  })

  it('surfaces a cache hit pointing at the freshness & cache section', () => {
    expect(byId('cache')?.tone).toBe('info')
    expect(byId('cache')?.jump).toBe('fresh')
  })

  it('surfaces stale-used freshness as a warning', () => {
    expect(byId('fresh')?.tone).toBe('warning')
  })

  it('surfaces a fired fallback as a warning pointing at decisions', () => {
    expect(byId('fallback')?.tone).toBe('warning')
    expect(byId('fallback')?.jump).toBe('decisions')
  })

  it('surfaces unprotected quality pointing at the protect section', () => {
    expect(byId('protect')?.tone).toBe('warning')
    expect(byId('protect')?.jump).toBe('protect')
  })
})

describe('summaryChips (passthrough when the backend emits them)', () => {
  it('uses backend chips and maps their filter target to a section id', () => {
    const r = baseReport()
    r.summary = [
      { id: 'saw', label: 'Saw 2', tone: 'neutral', filter: { target: 'saw' } },
      { id: 'cache', label: 'Cache hit', tone: 'info', filter: { target: 'cache' } },
      { id: 'cov', label: 'Quality unprotected', tone: 'warning', filter: { target: 'coverage' } },
    ]
    const chips = summaryChips(r)
    expect(chips).toHaveLength(3)
    expect(chips[0]?.label).toBe('Saw 2')
    expect(chips[1]?.jump).toBe('fresh')
    expect(chips[2]?.jump).toBe('protect')
  })
})

describe('warningChips', () => {
  it('keeps only warning and danger chips for the sub-header strip', () => {
    const chips = warningChips(baseReport())
    expect(chips.every((c) => c.tone === 'warning' || c.tone === 'danger')).toBe(true)
    expect(chips.map((c) => c.id)).toContain('dropped')
    expect(chips.map((c) => c.id)).toContain('fallback')
    expect(chips.map((c) => c.id)).not.toContain('saw')
  })
})
