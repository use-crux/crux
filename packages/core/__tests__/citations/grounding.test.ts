import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { applyToolMiddleware } from '../../tools/middleware'
import { grounding, citationSchema } from '../../citations'
import { prompt } from '../../prompt/prompt'
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

  it('supports tool-only grounding and validates citations against searched hits through tool middleware', async () => {
    const docs = retriever({
      id: 'docs',
      namespace: 'docs',
      retrieve: async () => [makeHit()],
    })
    const groundedDocs = grounding({
      id: 'docs-grounding',
      retriever: docs,
      inject: 'tool',
      tools: { prefix: true, include: ['search', 'getSource'] },
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
    expect(resolved.tools?.docsGroundingGetSource).toBeDefined()
    expect(resolved.toolMiddleware).toBeDefined()
    const tools = applyToolMiddleware(resolved.tools!, resolved.toolMiddleware)
    await (tools.docsGroundingSearch as any).execute({ query: 'hybrid', limit: 1 })
    const source = await (tools.docsGroundingGetSource as any).execute({ sourceId: 'guide.md', chunkId: 'chunk-1' })
    expect(source).toMatchObject({
      hits: [
        {
          sourceId: 'guide.md',
          chunkId: 'chunk-1',
          content: 'Hybrid search combines dense and sparse retrieval.',
        },
      ],
    })

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
      allowedHits: [
        {
          namespace: 'docs',
          sourceId: 'guide.md',
          chunkId: 'chunk-1',
          score: 0.9,
        },
      ],
    })
  })

  it('fails tool-only citations clearly when the model cites before searching', async () => {
    const docs = retriever({
      id: 'docs',
      namespace: 'docs',
      retrieve: async () => [makeHit()],
    })
    const groundedDocs = grounding({
      id: 'docs-grounding',
      retriever: docs,
      inject: 'tool',
      citations: { required: true, quotes: 'required' },
    })
    const answer = prompt({
      id: 'answer',
      use: [groundedDocs],
      output: z.object({
        answer: z.string(),
        citations: z.array(citationSchema),
      }),
      system: 'Answer from sources.',
    })

    const resolved = await answer.resolve({})
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

    expect(result.pass).toBe(false)
    expect(result.feedback).toContain('does not match a retrieved hit')
    expect(result.metadata?.grounding).toMatchObject({
      allowedHits: [],
    })
  })
})
