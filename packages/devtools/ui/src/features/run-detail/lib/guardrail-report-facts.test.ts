import { describe, expect, it } from 'vitest'
import { guardrailReportRows } from './guardrail-report-facts'

describe('guardrailReportRows findings', () => {
  it('renders classifier matches with exact evidence formatting', () => {
    const rows = guardrailReportRows({
      kind: 'guardrail.report',
      action: 'block',
      findings: [
        {
          type: 'media_classifier_match',
          category: 'unsafe',
          score: 0.9,
          threshold: 0.875,
        },
      ],
    })

    expect(presentationRows(rows)).toContainEqual([
      'match',
      'unsafe · 0.90 ≥ 0.875',
    ])
  })

  it('retains repeated match rows in authored finding order', () => {
    const rows = guardrailReportRows({
      kind: 'guardrail.report',
      action: 'block',
      findings: [
        {
          type: 'media_classifier_match',
          category: 'graphic-violence',
          score: 0.91,
          threshold: 0.9,
        },
        {
          type: 'media_classifier_match',
          category: 'sexual-content',
          score: 0.88,
          threshold: 0.85,
        },
        { type: 'media_not_inspected' },
      ],
    })

    expect(presentationRows(rows).slice(1)).toEqual([
      ['match', 'graphic-violence · 0.91 ≥ 0.90'],
      ['match', 'sexual-content · 0.88 ≥ 0.85'],
      ['inspection', 'not inspected', 'var(--devtools-warn)'],
    ])
    expect(rows.every((row) => typeof row[3] === 'string')).toBe(true)
    expect(new Set(rows.map((row) => row[3])).size).toBe(rows.length)
  })

  it('renders uninspected media in warning tone without fake scores', () => {
    const rows = guardrailReportRows({
      kind: 'guardrail.report',
      action: 'allow',
      findings: [{ type: 'media_not_inspected' }],
    })

    expect(presentationRows(rows)).toContainEqual([
      'inspection',
      'not inspected',
      'var(--devtools-warn)',
    ])
    expect(JSON.stringify(rows)).not.toMatch(/[≥]|score|threshold/)
  })

  it('retains a generic count for other finding types', () => {
    const rows = guardrailReportRows({
      kind: 'guardrail.report',
      action: 'redact',
      findings: [
        { type: 'email', count: 2 },
        { type: 'phone', count: 1 },
      ],
    })

    expect(presentationRows(rows)).toContainEqual(['findings', '2'])
  })
})

function presentationRows(
  rows: ReturnType<typeof guardrailReportRows>,
): [string, string, string?][] {
  return rows.map(([label, value, color]) =>
    color === undefined ? [label, value] : [label, value, color],
  )
}
