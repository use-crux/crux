import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { applyToolMiddleware } from '../../src/tools/middleware'
import { grounding, citationSchema } from '../../src/citations'
import { prompt } from '../../src/prompt/prompt'
import { retriever } from '../../src/retrieval'
import type { RetrieverHit } from '../../src/retrieval'
import type { SafetyRunContext } from '../../src/safety'
import type { Constraint } from '../../src/safety/constraint'

function makeHit(content = 'Hybrid search combines dense and sparse retrieval.'): RetrieverHit {
  return {
    namespace: 'docs',
    source: { id: 'guide.md' },
    chunkId: 'chunk-1',
    content,
    metadata: {},
    score: 0.9,
  }
}

function makeRunCtx(c: Constraint): SafetyRunContext {
  return {
    policy: { id: c.id, mode: 'enforce' },
    boundary: { id: c.on.id as never, kind: c.on.id as never },
    prompt: { id: 'answer' },
    model: { id: 'test' },
    trace: {},
    attempt: { index: 0, kind: 'initial' },
    metadata: {},
    findings: { add() {} },
    ...(c.on.path ? { path: c.on.path } : {}),
  }
}

async function runConstraint(c: Constraint, subject: unknown) {
  return c.run(subject as never, makeRunCtx(c) as never)
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
    const result = await runConstraint(
      resolved.constraints![0],
      {
        text: '',
        object: {
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
          source: { id: 'guide.md' },
          chunkId: 'chunk-1',
          content: 'Hybrid search combines dense and sparse retrieval.',
        },
      ],
    })

    const result = await runConstraint(
      resolved.constraints![0],
      {
        text: '',
        object: {
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
    const result = await runConstraint(
      resolved.constraints![0],
      {
        text: '',
        object: {
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
    )

    expect(result.pass).toBe(false)
    expect(result.feedback).toContain('does not match a retrieved hit')
    expect(result.metadata?.grounding).toMatchObject({
      allowedHits: [],
    })
  })
})
