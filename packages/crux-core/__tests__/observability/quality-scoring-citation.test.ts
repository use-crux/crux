import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { resolveCitations, type RetrieverHit } from '../../citations'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '../../observability'
import { quality, suite, target } from '../../quality'
import { llmJudge } from '../../scoring'

describe('canonical quality, scoring, and citation observability', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    resetObservabilityRuntime()
    vi.restoreAllMocks()
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('records LLM judge scoring as scoring.judge spans with bounded score artifacts', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const generate = vi.fn(async () => ({ object: { reasoning: 'Strong answer.', score: 9, detail: { issueCount: 0 } } }))
    const judge = llmJudge({
      id: 'answer_quality',
      criteria: 'Score answer quality.',
      scale: { min: 1, max: 5 },
      detailSchema: z.object({ issueCount: z.number() }),
      generate,
      model: 'judge-model',
    })

    const result = await judge.score({ input: 'Question?', output: 'Answer.', reference: 'Reference.' }, { evalId: 'eval-1' })
    await observe.flush()

    expect(result.score).toBe(5)
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:start',
        primitive: 'scoring.judge',
        name: 'judge.answer_quality',
        attributes: expect.objectContaining({
          metricId: 'answer_quality',
          evalId: 'eval-1',
          scaleMin: 1,
          scaleMax: 5,
          hasReference: true,
          hasDetailSchema: true,
        }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'score.report',
        attributes: expect.objectContaining({ metricId: 'answer_quality', primitive: 'scoring.judge' }),
        preview: expect.objectContaining({ score: 5, rawScore: 9, reasoningPreview: 'Strong answer.' }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:end',
        status: 'ok',
        attributes: expect.objectContaining({ score: 5, rawScore: 9, clamped: true, hasReasoning: true }),
      }),
    )
  })

  it('records citation validation as citation.check spans and report artifacts', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const hits: RetrieverHit[] = [
      {
        namespace: 'docs',
        sourceId: 'refund',
        chunkId: 'policy',
        content: 'Refunds are available within 14 days.',
        score: 0.94,
        metadata: {},
      },
    ]

    const result = resolveCitations(
      [
        { namespace: 'docs', sourceId: 'refund', chunkId: 'policy', quote: 'Refunds are available within 14 days.' },
        { namespace: 'docs', sourceId: 'refund', chunkId: 'missing', quote: 'Missing.' },
      ],
      hits,
      { quotes: 'required' },
    )
    await observe.flush()

    expect(result.valid).toBe(false)
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:start',
        primitive: 'citation.check',
        name: 'citation.resolve',
        attributes: expect.objectContaining({ citationCount: 2, allowedHitCount: 1, quotePolicy: 'required' }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'citation.report',
        attributes: expect.objectContaining({ primitive: 'citation.check', valid: false }),
        preview: expect.objectContaining({
          summary: expect.objectContaining({ citationCount: 2, validCitationCount: 1, invalidCitationCount: 1 }),
        }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:end',
        status: 'ok',
        attributes: expect.objectContaining({ valid: false, invalidCitationCount: 1, issueCodes: ['unknown_hit'] }),
      }),
    )
  })

  it('records quality experiments and cases as eval spans', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const dir = await mkdtemp(join(tmpdir(), 'crux-quality-observe-'))
    tempDirs.push(dir)
    const q = quality({ id: 'support-quality', dir })
    const supportSuite = suite('support-suite', (test) => {
      test('refund answer', { id: 'refund-answer', input: { question: 'Refund?' }, expected: { answer: 'yes' } })
    })

    const experiment = await q.evaluate({
      id: 'experiment-1',
      suite: supportSuite,
      target: target.custom({
        id: 'support-target',
        run: async () => ({ answer: 'yes' }),
      }),
      scorers: [
        {
          id: 'pass-score',
          score: async () => ({ kind: 'numeric', name: 'pass-score', value: 1, passed: true }),
        },
      ],
    })
    await observe.flush()

    expect(experiment.status).toBe('passed')
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:start',
        primitive: 'eval.run',
        name: 'quality.evaluate',
        attributes: expect.objectContaining({ qualityId: 'support-quality', experimentId: 'experiment-1', suiteId: 'support-suite' }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:start',
        primitive: 'eval.case',
        name: 'quality.case.refund-answer',
        attributes: expect.objectContaining({ caseId: 'refund-answer', variantId: 'default', targetId: 'support-target' }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:end',
        status: 'ok',
        attributes: expect.objectContaining({ status: 'passed', scoreCount: 1, assertionPassed: true }),
      }),
    )
  })

  it('records feedback writes as feedback.record spans', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const dir = await mkdtemp(join(tmpdir(), 'crux-quality-feedback-'))
    tempDirs.push(dir)
    const q = quality({ id: 'support-quality', dir })

    const record = await q.feedback.record({
      traceId: 'trace-1',
      experimentId: 'experiment-1',
      caseId: 'case-1',
      rating: -1,
      comment: 'Expected the answer to cite the refund policy.',
      tags: ['citation'],
    })
    await observe.flush()

    expect(record.id).toContain('feedback-')
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:start',
        primitive: 'feedback.record',
        name: 'feedback.record',
        attributes: expect.objectContaining({
          qualityId: 'support-quality',
          traceId: 'trace-1',
          experimentId: 'experiment-1',
          caseId: 'case-1',
          rating: -1,
          tagCount: 1,
          hasComment: true,
        }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:end',
        status: 'ok',
        attributes: expect.objectContaining({ feedbackId: record.id, status: 'new' }),
      }),
    )
  })
})
