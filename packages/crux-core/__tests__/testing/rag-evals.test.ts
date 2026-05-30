import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { prompt } from '../../define'
import { grounding, citationSchema } from '../../citations'
import { retriever, retrievalPipeline, retrievalStage, type RetrieverHit } from '../../retrieval'
import {
  evaluateGroundedAnswer,
  evaluateRag,
  evaluateRetrieval,
  ragDataset,
  type GenerateFn,
} from '../../testing'

function hit(overrides: Partial<RetrieverHit> = {}): RetrieverHit {
  return {
    namespace: 'docs',
    sourceId: 'refunds.md',
    chunkId: 'chunk-1',
    content: 'Refunds are available for eligible plans within 30 days.',
    metadata: { product: 'billing', visibility: 'public' },
    score: 0.9,
    ...overrides,
  }
}

describe('ragDataset()', () => {
  it('preserves typed case input and rejects duplicate case ids', () => {
    const dataset = ragDataset({
      id: 'support',
      cases: [
        {
          id: 'refunds',
          input: { question: 'How do refunds work?' },
          expected: { sources: [{ sourceId: 'refunds.md' }] },
        },
      ],
    })

    expect(dataset._tag).toBe('RagDataset')
    expect(dataset.cases[0].input.question).toBe('How do refunds work?')
    expect(() =>
      ragDataset({
        id: 'dupes',
        cases: [
          { id: 'same', input: { question: 'one' } },
          { id: 'same', input: { question: 'two' } },
        ],
      }),
    ).toThrow(/duplicate case id/i)
  })

  it('rejects non-portable expected metadata values', () => {
    expect(() =>
      ragDataset({
        id: 'bad-metadata',
        cases: [
          {
            id: 'bad',
            input: { question: 'x' },
            expected: {
              sources: [{ type: 'metadata', where: { matcher: () => true } }],
            },
          },
        ],
      }),
    ).toThrow(/serializable/i)
  })
})

describe('evaluateRetrieval()', () => {
  it('computes deterministic retrieval metrics for source, chunk, and metadata expectations', async () => {
    const docs = retriever({
      id: 'docs',
      namespace: 'docs',
      retrieve: async () => [
        hit({ sourceId: 'refunds.md', chunkId: 'chunk-1', score: 0.9 }),
        hit({ sourceId: 'pricing.md', chunkId: 'chunk-7', score: 0.4, metadata: { product: 'billing' } }),
      ],
    })
    const dataset = ragDataset({
      id: 'support',
      cases: [
        {
          id: 'refunds',
          input: { question: 'How do refunds work?' },
          expected: {
            sources: [
              { sourceId: 'refunds.md', chunkId: 'chunk-1' },
              { type: 'metadata', where: { product: 'billing' } },
            ],
          },
        },
      ],
    })

    const report = await evaluateRetrieval({ id: 'retrieval', retriever: docs, dataset, k: [1, 2] })

    expect(report.summary.total).toBe(1)
    expect(report.summary.passed).toBe(1)
    expect(report.summary.retrieval?.hitRateAtK[1]).toBe(1)
    expect(report.summary.retrieval?.recallAtK[1]).toBe(1)
    expect(report.summary.retrieval?.precisionAtK[1]).toBe(1)
    expect(report.summary.retrieval?.mrr).toBe(1)
    expect(report.cases[0].retrieval.metrics.status).toBe('passed')
    expect(report.cases[0].evidence[0].contentPreview).toContain('Refunds are available')
  })

  it('marks retrieval metrics as not applicable when a case has no expected sources', async () => {
    const docs = retriever({
      id: 'docs',
      namespace: 'docs',
      retrieve: async () => [hit()],
    })
    const dataset = ragDataset({
      id: 'smoke',
      cases: [{ id: 'smoke', input: { question: 'What can I ask?' } }],
    })

    const report = await evaluateRetrieval({ id: 'retrieval', retriever: docs, dataset })

    expect(report.cases[0].retrieval.metrics.status).toBe('not_applicable')
    expect(report.summary.passed).toBe(1)
  })
})

describe('evaluateGroundedAnswer()', () => {
  it('checks deterministic answer assertions and validates citations against grounded hits', async () => {
    const docs = retriever({
      id: 'docs',
      namespace: 'docs',
      retrieve: async () => [hit()],
    })
    const groundedDocs = grounding({
      id: 'docs',
      retriever: docs,
      query: ({ input }) => input.question as string,
      citations: { required: true, quotes: 'required' },
    })
    const answer = prompt({
      id: 'answer',
      use: [groundedDocs],
      input: z.object({ question: z.string() }),
      output: z.object({
        answer: z.string(),
        citations: z.array(citationSchema),
      }),
      system: 'Answer from sources.',
    })
    const generate = vi.fn(async () => ({
      object: {
        answer: 'Refunds are available within 30 days.',
        citations: [{ sourceId: 'refunds.md', chunkId: 'chunk-1', quote: 'within 30 days' }],
      },
      text: 'Refunds are available within 30 days.',
    })) as GenerateFn
    const dataset = ragDataset({
      id: 'answers',
      cases: [
        {
          id: 'refunds',
          input: { question: 'How do refunds work?' },
          expected: {
            answer: { contains: ['30 days'] },
            citations: [{ sourceId: 'refunds.md', chunkId: 'chunk-1' }],
          },
        },
      ],
    })

    const report = await evaluateGroundedAnswer({
      id: 'grounded-answer',
      target: { prompt: answer, grounding: groundedDocs },
      generate,
      dataset,
    })

    expect(report.summary.passed).toBe(1)
    expect(report.cases[0].answer.status).toBe('passed')
    expect(report.cases[0].citations.status).toBe('passed')
    expect(report.cases[0].citations.artifact?.summary.validCitationCount).toBe(1)
  })

  it('classifies invalid citations and unsupported answers', async () => {
    const docs = retriever({
      id: 'docs',
      namespace: 'docs',
      retrieve: async () => [hit()],
    })
    const groundedDocs = grounding({
      id: 'docs',
      retriever: docs,
      query: ({ input }) => input.question as string,
      citations: { required: true, quotes: 'required' },
    })
    const answer = prompt({
      id: 'answer',
      input: z.object({ question: z.string() }),
      output: z.object({
        answer: z.string(),
        citations: z.array(citationSchema),
      }),
      system: 'Answer from sources.',
    })
    const generate = vi.fn(async () => ({
      object: {
        answer: 'Refunds take 90 days.',
        citations: [{ sourceId: 'refunds.md', chunkId: 'missing', quote: '90 days' }],
      },
      text: 'Refunds take 90 days.',
    })) as GenerateFn
    const dataset = ragDataset({
      id: 'answers',
      cases: [
        {
          id: 'refunds',
          input: { question: 'How do refunds work?' },
          expected: {
            answer: { contains: ['30 days'] },
            citations: [{ sourceId: 'refunds.md', chunkId: 'chunk-1' }],
          },
        },
      ],
    })

    const report = await evaluateGroundedAnswer({
      id: 'grounded-answer',
      target: { prompt: answer, grounding: groundedDocs },
      generate,
      dataset,
    })

    expect(report.summary.failed).toBe(1)
    expect(report.cases[0].failureTypes).toContain('invalid_citation')
    expect(report.cases[0].failureTypes).toContain('unsupported_answer')
    expect(report.summary.byFailureType.invalid_citation).toBe(1)
  })
})

describe('evaluateRag()', () => {
  it('includes retrieval traces and compares baseline with candidate configs', async () => {
    const baseRetriever = retriever({
      id: 'docs',
      namespace: 'docs',
      retrieve: async () => [hit({ sourceId: 'wrong.md', chunkId: 'chunk-9', score: 0.8 })],
    })
    const candidateRetriever = retrievalPipeline(
      retriever({
        id: 'docs',
        namespace: 'docs',
        retrieve: async () => [hit()],
      }),
      [
        retrievalStage({
          name: 'only-public',
          phase: 'hits',
          run: ({ hits }) => hits.filter((item) => item.metadata.visibility === 'public'),
        }),
      ],
    )
    const baselineGrounding = grounding({
      id: 'baseline',
      retriever: baseRetriever,
      query: ({ input }) => input.question as string,
    })
    const candidateGrounding = grounding({
      id: 'candidate',
      retriever: candidateRetriever,
      query: ({ input }) => input.question as string,
    })
    const answer = prompt({
      id: 'answer',
      input: z.object({ question: z.string() }),
      output: z.object({ answer: z.string(), citations: z.array(citationSchema) }),
      system: 'Answer from sources.',
    })
    const generate = vi.fn(async () => ({
      object: {
        answer: 'Refunds are available within 30 days.',
        citations: [{ sourceId: 'refunds.md', chunkId: 'chunk-1', quote: 'within 30 days' }],
      },
      text: 'Refunds are available within 30 days.',
    })) as GenerateFn
    const dataset = ragDataset({
      id: 'rag',
      cases: [
        {
          id: 'refunds',
          input: { question: 'How do refunds work?' },
          expected: {
            sources: [{ sourceId: 'refunds.md' }],
            answer: { contains: ['30 days'] },
            citations: [{ sourceId: 'refunds.md', chunkId: 'chunk-1' }],
          },
        },
      ],
    })

    const report = await evaluateRag({
      id: 'rag',
      target: { prompt: answer, grounding: baselineGrounding },
      generate,
      dataset,
      configs: {
        baseline: { label: 'baseline', grounding: baselineGrounding },
        candidate: { label: 'candidate', grounding: candidateGrounding },
      },
    })

    expect(report.comparisons?.[0].caseDeltas[0].baseline.status).toBe('failed')
    expect(report.comparisons?.[0].caseDeltas[0].candidate.status).toBe('passed')
    expect(report.comparisons?.[0].metricDeltas.passRate).toBe(1)
    expect(report.cases.find((item) => item.configRole === 'candidate')?.trace?.available).toBe(true)
    expect(report.exportFailedCases().cases).toHaveLength(1)
  })
})
