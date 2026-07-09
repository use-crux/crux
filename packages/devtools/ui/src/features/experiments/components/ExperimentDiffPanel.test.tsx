import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { QualityExperimentDiff } from '@/types'
import { ExperimentDiffPanelView } from './ExperimentDiffPanel'

const diff = (over: Partial<QualityExperimentDiff> = {}): QualityExperimentDiff => ({
  schemaVersion: 1,
  a: { experimentId: '01KTAAAAAAAAAAAAAAAAAAAAAA' },
  b: { experimentId: '01KTBBBBBBBBBBBBBBBBBBBBBB' },
  comparable: true,
  fingerprintDrift: [],
  scores: [{ name: 'helpful', aMean: 0.81, bMean: 0.74, delta: -0.07, sem: 0.02, significant: true }],
  cases: [{ caseId: 'refund', variant: 'default', aPassed: true, bPassed: false, scoreDeltas: { helpful: -0.31 } }],
  onlyInA: ['legacy-case'],
  onlyInB: [],
  gatesVerdict: { aPassed: true, bPassed: false },
  ...over,
})

describe('ExperimentDiffPanelView', () => {
  it('renders score delta rows, the case table, and onlyIn lists', () => {
    const html = renderToStaticMarkup(<ExperimentDiffPanelView diff={diff()} onOpenExperiment={() => {}} />)
    expect(html).toContain('helpful')
    expect(html).toContain('-0.07') // aggregate score delta
    expect(html).toContain('refund · default')
    expect(html).toContain('only in A: legacy-case')
  })

  it('shows a demotion banner naming drifted identity when comparable is false', () => {
    const html = renderToStaticMarkup(
      <ExperimentDiffPanelView
        diff={diff({ comparable: false, fingerprintDrift: ['dataset', 'scorers'] })}
        onOpenExperiment={() => {}}
      />,
    )
    expect(html).toContain('Not directly comparable')
    expect(html).toContain('dataset, scorers')
  })

  it('renders nothing when there is no diff', () => {
    expect(renderToStaticMarkup(<ExperimentDiffPanelView diff={null} onOpenExperiment={() => {}} />)).toBe('')
  })
})
