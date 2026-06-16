import { describe, expect, it } from 'vitest'
import type { QualityAssertionOutcome, QualityCellEvidence, QualityCheckEvidence, QualitySourceFrame } from '@/types'
import { assertionMessage, assertionStatement, evaluatedStatement } from './cell-evidence-format'

const frame: QualitySourceFrame = {
  kind: 'source-frame',
  sourceRef: '/workspace/evals/support.eval.ts:12:5',
  authoredFile: '/workspace/evals/support.eval.ts',
  authoredLine: 12,
  authoredColumn: 5,
  frameStartLine: 10,
  frameEndLine: 14,
  lines: [{ line: 12, text: 'ctx.expect(ctx.score.citation_valid).toBeGreaterThanOrEqual(0.7)', role: 'failed' }],
  contentHash: 'sha256:test',
  capturedAt: '2026-06-16T00:00:00.000Z',
  stale: false,
  resolver: 'disk',
}

function outcome(overrides: Partial<QualityAssertionOutcome>): QualityAssertionOutcome {
  return {
    id: 'expect:assert:0',
    level: 'evaluation',
    phase: 'assert',
    index: 0,
    status: 'failed',
    matcher: 'toBe',
    soft: false,
    ...overrides,
  }
}

function evidence(
  checks: readonly QualityCheckEvidence[],
  outcomes: readonly QualityAssertionOutcome[],
): QualityCellEvidence {
  return {
    _tag: 'QualityCellEvidence',
    schemaVersion: 1,
    experimentId: '01TEST',
    evaluationId: 'examples.support-citations',
    generatedAt: '2026-06-16T00:00:00.000Z',
    cell: {
      caseId: 'case',
      variantName: 'default',
      trial: 0,
      status: 'failed',
      durationMs: 1,
      traceIds: [],
      capturedSignals: [],
    },
    trialSummary: {
      selectedTrial: 0,
      total: 1,
      passed: 0,
      failed: 1,
      errored: 0,
      skipped: 0,
      verdict: 'stable-fail',
      trials: [{ trial: 0, status: 'failed', durationMs: 1, primaryFailure: 'failed' }],
    },
    io: { input: 'input', output: 'output', outputTruncated: false, redactionApplied: false },
    scores: [],
    assertions: { ran: outcomes.length, notEvaluated: 0, outcomes },
    checks,
    code: { primaryFrame: frame, valuesAtCheck: [] },
    baseline: { kind: 'unavailable', reason: 'no-baseline' },
    trace: { traceIds: [], retainedTraceIds: [], hotSpanIds: [], spans: [] },
    repro: { command: 'crux', args: [] },
    provenance: { experimentRecordPath: 'experiments/01TEST.json' },
  }
}

describe('cell evidence formatting', () => {
  it('renders assertion rows with the authored expect subject', () => {
    expect(
      assertionStatement(
        outcome({
          matcher: 'toBe',
          subjectExpr: 'Boolean(writerCall)',
          expected: { label: 'expected', value: true, preview: 'true', redacted: false },
        }),
      ),
    ).toBe('expect(Boolean(writerCall)).toBe(true)')
  })

  it('quotes string matcher arguments in assertion rows', () => {
    expect(
      assertionStatement(
        outcome({
          matcher: 'toCite',
          subjectExpr: 'output',
          expected: { label: 'expected', value: '§seat-policy#v2', preview: '§seat-policy#v2', redacted: false },
        }),
      ),
    ).toBe('expect(output).toCite("§seat-policy#v2")')
  })

  it('prefers the score-threshold message for score assertion rows', () => {
    const scoreOutcome = outcome({
      matcher: 'toBeGreaterThanOrEqual',
      subjectExpr: 'score.citation_valid',
      expected: { label: 'expected', value: 0.7, preview: '0.7', redacted: false },
      sourceFrame: frame,
      message: 'expected 0.58 to be >= 0.7',
    })
    const threshold: QualityCheckEvidence = {
      kind: 'score-threshold',
      scoreName: 'citation_valid',
      score: 0.58,
      operator: '>=',
      threshold: 0.7,
      passed: false,
      source: 'assertion',
      message: '0.58 is below the 0.70 floor',
      sourceFrame: frame,
    }

    expect(assertionStatement(scoreOutcome)).toBe('expect(score.citation_valid).toBeGreaterThanOrEqual(0.70)')
    expect(assertionMessage([threshold], scoreOutcome)).toBe('0.58 is below the 0.70 floor')
  })

  it('uses the failing score threshold as the headline when present', () => {
    const scoreOutcome = outcome({
      matcher: 'toBeGreaterThanOrEqual',
      subjectExpr: 'score.citation_valid',
      expected: { label: 'expected', value: 0.7, preview: '0.7', redacted: false },
      sourceFrame: frame,
    })
    const threshold: QualityCheckEvidence = {
      kind: 'score-threshold',
      scoreName: 'citation_valid',
      score: 0.58,
      operator: '>=',
      threshold: 0.7,
      passed: false,
      source: 'assertion',
      message: '0.58 is below the 0.70 floor',
      sourceFrame: frame,
    }

    expect(evaluatedStatement(evidence([threshold], [scoreOutcome]))).toEqual({
      rendered: 'citation_valid (0.58) >= 0.70 → false',
      passed: false,
    })
  })

  it('does not fall back to opaque boolean equality for assertion headlines', () => {
    const boolOutcome = outcome({
      id: 'expect:case:0',
      matcher: 'toBe',
      subjectExpr: 'Boolean(writerCall)',
      expected: { label: 'expected', value: true, preview: 'true', redacted: false },
      expression: {
        left: { label: 'actual', value: false, preview: 'false', redacted: false },
        operator: '==',
        right: { label: 'expected', value: true, preview: 'true', redacted: false },
        result: false,
        rendered: 'false == true => false',
      },
    })
    const check: QualityCheckEvidence = {
      kind: 'assertion',
      outcomeId: 'expect:case:0',
      status: 'failed',
      summary: 'expected false to be true',
      expression: boolOutcome.expression,
      message: 'expected false to be true',
    }

    expect(evaluatedStatement(evidence([check], [boolOutcome]))).toEqual({
      rendered: 'expect(Boolean(writerCall)).toBe(true) → false',
      passed: false,
    })
  })
})
