import { describe, expect, it } from 'vitest'
import type { ExperimentRecord } from '../../quality/schemas'
import { compareExperiments } from '../../quality/internal/compare'

function cell(input: {
  caseId: string
  score: number
  passed: boolean
  output?: unknown
}): ExperimentRecord['cells'][number] {
  return {
    caseId: input.caseId,
    variantName: 'default',
    trial: 0,
    status: input.passed ? 'passed' : 'failed',
    input: { id: input.caseId },
    ...(input.output !== undefined ? { output: input.output } : {}),
    scores: [
      { name: 'quality', score: input.score, costClass: 'code' },
      { name: 'pass', score: input.passed ? 1 : 0, costClass: 'code' },
    ],
    assertions: { ran: 1, notEvaluated: 0, outcomes: [] },
    durationMs: 1,
    traceIds: [],
    capturedSignals: [],
  }
}

function record(input: {
  experimentId: string
  configFingerprint?: string
  cells: ExperimentRecord['cells']
  passed: boolean
}): ExperimentRecord {
  return {
    schemaVersion: 2,
    experimentId: input.experimentId,
    evaluationId: 'diff.fixture',
    qualityId: 'test',
    startedAt: '2026-07-08T00:00:00.000Z',
    endedAt: '2026-07-08T00:00:01.000Z',
    configFingerprint: input.configFingerprint ?? 'same',
    taskFingerprint: 'task',
    filteredRun: false,
    replay: { mode: 'live' },
    variants: [{ name: 'default', overrideKeys: [] }],
    cells: input.cells,
    aggregates: { perVariant: {} },
    gates: { passed: input.passed, informational: false, results: [] },
    passed: input.passed,
  }
}

describe('compareExperiments', () => {
  it('returns schema-versioned per-score and per-case deltas with honest unmatched cases', () => {
    const reference = record({
      experimentId: '01KTA',
      cells: [cell({ caseId: 'easy', score: 1, passed: true }), cell({ caseId: 'hard', score: 0.8, passed: true })],
      passed: true,
    })
    const candidate = record({
      experimentId: '01KTB',
      cells: [
        cell({ caseId: 'easy', score: 1, passed: true }),
        cell({ caseId: 'hard', score: 0.4, passed: false }),
        cell({ caseId: 'new', score: 0.9, passed: true }),
      ],
      passed: false,
    })

    const diff = compareExperiments(reference, candidate)

    expect(diff).toMatchObject({
      schemaVersion: 1,
      a: { experimentId: '01KTA' },
      b: { experimentId: '01KTB' },
      comparable: true,
      fingerprintDrift: [],
      onlyInA: [],
      onlyInB: ['new'],
      gatesVerdict: { aPassed: true, bPassed: false },
    })
    expect(diff.scores.find((score) => score.name === 'quality')).toMatchObject({
      aMean: 0.9,
      bMean: 0.7,
      delta: -0.2,
      significant: true,
    })
    expect(diff.cases).toContainEqual({
      caseId: 'hard',
      variant: 'default',
      aPassed: true,
      bPassed: false,
      scoreDeltas: { pass: -1, quality: -0.4 },
    })
  })

  it('marks drifted fingerprints as non-comparable while still rendering deltas', () => {
    const reference = record({
      experimentId: '01KTA',
      configFingerprint: 'old',
      cells: [cell({ caseId: 'easy', score: 1, passed: true })],
      passed: true,
    })
    const candidate = record({
      experimentId: '01KTB',
      configFingerprint: 'new',
      cells: [cell({ caseId: 'easy', score: 0.5, passed: false })],
      passed: false,
    })

    const diff = compareExperiments(reference, candidate)

    expect(diff.comparable).toBe(false)
    expect(diff.fingerprintDrift).toEqual(['config'])
    expect(diff.scores.find((score) => score.name === 'quality')?.delta).toBe(-0.5)
  })
})
