import { describe, expect, it } from 'vitest'
import type { QualityBaselineRecord, QualityExperimentDetail } from '@/types'
import {
  aggregateBaselineReference,
  candidateDeltas,
  collectRollupScoreNames,
  comparisonSides,
  shouldShowComparisonPanel,
} from './experiment-comparison-model'

const baseExperiment = {
  schemaVersion: 1,
  experimentId: 'candidate-exp',
  evaluationId: 'prompt.brand-profile',
  qualityId: 'quality',
  startedAt: '2026-06-15T00:00:00.000Z',
  endedAt: '2026-06-15T00:00:01.000Z',
  configFingerprint: 'cfg',
  taskFingerprint: 'task',
  filteredRun: false,
  replay: { mode: 'replay-strict' },
  variants: [{ name: 'default', overrideKeys: [] }],
  cases: [],
  aggregates: {
    perVariant: {
      default: {
        cells: 1,
        passed: 1,
        failed: 0,
        errored: 0,
        skipped: 0,
        passRate: 1,
        scores: { helpful: { mean: 0.8, sem: 0.1, n: 1 } },
        latency: { meanMs: 10, p95Ms: 12 },
      },
    },
  },
  gates: { passed: true, informational: false, results: [] },
  passed: true,
} satisfies QualityExperimentDetail

describe('experiment comparison display model', () => {
  it('treats promoted-baseline deltas as the candidate side even for a single-variant run', () => {
    const exp = {
      ...baseExperiment,
      baselineRef: { baselineId: 'baseline-1', experimentId: 'baseline-exp' },
      comparison: {
        kind: 'promoted',
        baseline: 'baseline-exp',
        deltas: [{ variantName: 'default', scoreName: 'helpful', meanDelta: 0.1, sem: 0.02, n: 1 }],
        unmatchedCases: { baselineOnly: [], candidateOnly: [] },
      },
    } satisfies QualityExperimentDetail

    expect(comparisonSides(exp)).toEqual({ base: 'baseline-exp', candidate: 'default' })
    expect(candidateDeltas(exp.comparison, 'default')).toHaveLength(1)
  })

  it('shows the comparison side panel when promoted comparisons have score deltas but no cost tradeoff', () => {
    expect(
      shouldShowComparisonPanel({
        comparison: {
          kind: 'promoted',
          baseline: 'baseline-exp',
          deltas: [{ variantName: 'default', scoreName: 'helpful', meanDelta: 0, sem: 0, n: 1 }],
          unmatchedCases: { baselineOnly: [], candidateOnly: [] },
        },
        hasCostTradeoff: false,
        hasLatencyTradeoff: false,
        candidateDeltaCount: 1,
      }),
    ).toBe(true)
  })

  it('aggregates promoted baseline reference scores for a baseline rollup card', () => {
    const baseline = {
      schemaVersion: 1,
      baselineId: 'baseline-1',
      evaluationId: 'prompt.brand-profile',
      experimentId: 'baseline-exp',
      promotedAt: '2026-06-15T00:00:00.000Z',
      configFingerprint: 'cfg',
      reference: {
        a: { helpful: 1, pass: 1 },
        b: { helpful: 0.5, pass: 0 },
      },
    } satisfies QualityBaselineRecord

    expect(collectRollupScoreNames(baseExperiment, baseline)).toEqual(['helpful', 'pass'])
    expect(aggregateBaselineReference(baseline.reference)).toMatchObject({
      caseCount: 2,
      passRate: 0.5,
      scores: {
        helpful: { mean: 0.75, n: 2 },
        pass: { mean: 0.5, n: 2 },
      },
    })
  })
})
