import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { resolveCitations, type RetrieverHit } from '../../src/citations'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '../../src/observability'
import { judge as createJudge } from '../../src/scoring'

describe('scoring and citation observability', () => {
  afterEach(() => {
    resetObservabilityRuntime()
    vi.restoreAllMocks()
  })

    it('records LLM judge scoring as scoring.judge spans with bounded score artifacts', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const generate = vi.fn(async () => ({ object: { reasoning: 'Strong answer.', score: 9, detail: { issueCount: 0 } } }))
    const judge = createJudge({
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
        definitionRefs: [
          { id: 'scorer:answer_quality', kind: 'scorer', role: 'invoked-scorer' },
        ],
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
        source: { id: 'refund' },
        chunkId: 'policy',
        content: 'Refunds are available within 14 days.',
        score: 0.94,
        metadata: {},
      },
    ]

    const result = resolveCitations(
      [
        {
          namespace: 'docs',
          sourceId: 'refund',
          chunkId: 'policy',
          quote: 'Refunds are available within 14 days.',
          outputSpan: { start: 9, end: 29 },
          outputQuote: 'available within 14',
        },
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
          markers: expect.arrayContaining([
            expect.objectContaining({
              marker: '[1]',
              start: 9,
              end: 29,
              outputQuote: 'available within 14',
            }),
          ]),
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

})
