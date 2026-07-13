import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { QualityJudgeReport } from '@/types'
import { JudgeReportPanelView } from '@/shared/quality/JudgeReportPanel'

const report: QualityJudgeReport = {
  schemaVersion: 1,
  evaluationId: 'evals.bakeoff',
  scorers: [
    {
      name: 'helpful',
      threshold: 0.7,
      labeled: 42,
      confusion: { tp: 30, fp: 3, fn: 4, tn: 5 },
      agreement: 0.833,
      precision: 0.909,
      recall: 0.882,
      kappa: 0.61,
      disagreements: [
        { experimentId: '01KTA', caseId: 'refund', variant: 'candidate', trial: 0, human: 'fail', judgeScore: 0.82, rationale: 'x' },
      ],
    },
  ],
}

describe('JudgeReportPanelView', () => {
  it('renders the confusion matrix, agreement, and kappa from a fixture report', () => {
    const html = renderToStaticMarkup(<JudgeReportPanelView report={report} onOpenExperiment={() => {}} />)
    expect(html).toContain('helpful')
    expect(html).toContain('83%') // agreement 0.833 → 83%
    expect(html).toContain('0.61') // kappa
    // 2×2 grid quadrant labels + a disagreement row
    expect(html).toContain('Judge pass · Human pass')
    expect(html).toContain('human fail')
    expect(html).toContain('refund · candidate')
  })

  it('renders the label hint empty state when there are no scored labels', () => {
    const html = renderToStaticMarkup(<JudgeReportPanelView report={null} onOpenExperiment={() => {}} />)
    expect(html).toContain('crux quality label')
  })

  it('scopes to a single scorer when a name is provided', () => {
    const two: QualityJudgeReport = {
      ...report,
      scorers: [report.scorers[0], { ...report.scorers[0], name: 'accurate' }],
    }
    const html = renderToStaticMarkup(
      <JudgeReportPanelView report={two} scorerName="accurate" onOpenExperiment={() => {}} />,
    )
    expect(html).toContain('accurate')
    expect(html).not.toContain('>helpful<')
  })
})
