import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { grounding, citationSchema } from '../../citations'
import { prompt } from '../../define'
import { retriever } from '../../retrieval'
import type { RetrieverHit } from '../../retrieval'

function makeHit(content = 'Hybrid search combines dense and sparse retrieval.'): RetrieverHit {
  return {
    namespace: 'docs',
    sourceId: 'guide.md',
    chunkId: 'chunk-1',
    content,
    metadata: {},
    score: 0.9,
  }
}

describe('grounding()', () => {
  it('injects retrieved context and a citation constraint by default', async () => {
    const retrieve = vi.fn(async () => [makeHit()])
    const docs = retriever({
      id: 'docs',
      namespace: 'docs',
      retrieve,
    })
    const groundedDocs = grounding({
      id: 'docs-grounding',
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

    const resolved = await answer.resolve({ input: { question: 'what is hybrid search?' } })

    expect(retrieve).toHaveBeenCalledWith('what is hybrid search?', { limit: undefined })
    expect(resolved.system).toContain('Hybrid search combines')
    expect(resolved.constraints).toHaveLength(1)
    const result = await resolved.constraints![0].check(
      {
        text: '',
        parsed: {
          answer: 'Hybrid search combines retrieval modes.',
          citations: [
            {
              sourceId: 'guide.md',
              chunkId: 'chunk-1',
              quote: 'dense and sparse retrieval',
            },
          ],
        },
      },
      { promptId: 'answer', model: 'test', traceId: undefined, attempt: 0, metadata: {} },
    )
    expect(result.pass).toBe(true)
    expect(result.metadata?.grounding).toMatchObject({
      groundingId: 'docs-grounding',
      retrieverId: 'docs',
      query: 'what is hybrid search?',
    })
  })

  it('supports tool-only grounding and validates citations against searched hits', async () => {
    const docs = retriever({
      id: 'docs',
      namespace: 'docs',
      retrieve: async () => [makeHit()],
    })
    const groundedDocs = grounding({
      id: 'docs-grounding',
      retriever: docs,
      query: ({ input }) => input.question as string,
      inject: 'tool',
      tools: { prefix: true },
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

    const resolved = await answer.resolve({ input: { question: 'hybrid?' } })

    expect(resolved.system).toBe('Answer from sources.')
    expect(resolved.tools?.docsGroundingSearch).toBeDefined()
    await (resolved.tools?.docsGroundingSearch as any).execute({ query: 'hybrid', limit: 1 })

    const result = await resolved.constraints![0].check(
      {
        text: '',
        parsed: {
          answer: 'Hybrid search combines retrieval modes.',
          citations: [
            {
              sourceId: 'guide.md',
              chunkId: 'chunk-1',
              quote: 'dense and sparse retrieval',
            },
          ],
        },
      },
      { promptId: 'answer', model: 'test', traceId: undefined, attempt: 0, metadata: {} },
    )

    expect(result.pass).toBe(true)
  })
})
