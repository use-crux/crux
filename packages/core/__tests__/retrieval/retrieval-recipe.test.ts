import { describe, expect, it, vi } from 'vitest'
import { fanout, retriever as makeRetriever, retrievalRecipe, retrievalStep, retrieve, rerank } from '../../retrieval'
import type { RecipeTrace, RetrievalModel, RetrieverHit } from '../../retrieval'
import { createIndexedKnowledgeStore } from '../../indexed-knowledge'
import { inMemoryRecordStore } from '../../storage'

function hit(id: string, content: string, score = 1, metadata: Record<string, unknown> = {}): RetrieverHit {
  return {
    namespace: 'docs',
    sourceId: id.split('/')[0] ?? id,
    chunkId: id.split('/')[1] ?? '0',
    content,
    metadata,
    score,
    provenance: { rawScore: score },
  }
}

function baseRetriever(results: Record<string, RetrieverHit[]>) {
  const retrieveFn = vi.fn(async (query: string) => results[query] ?? [])
  return {
    retriever: makeRetriever({
      id: 'docs',
      namespace: 'docs',
      retrieve: retrieveFn,
    }),
    retrieve: retrieveFn,
  }
}

describe('retrievalRecipe', () => {
  it('runs a named recipe over one retriever and returns a structured trace', async () => {
    const { retriever, retrieve: retrieveFn } = baseRetriever({
      launch: [hit('doc-1/a', 'Launch checklist')],
    })

    const recipe = retrievalRecipe({
      id: 'launch-recipe',
      retriever,
      steps: [retrieve({ limit: 5 })],
    })

    const { hits, trace } = await recipe.retrieveWithTrace('launch')

    expect(hits).toEqual([
      expect.objectContaining({
        ...hit('doc-1/a', 'Launch checklist'),
        provenance: {
          rawScore: 1,
          matchedQueries: ['launch'],
          ranks: [1],
        },
      }),
    ])
    expect(retrieveFn).toHaveBeenCalledWith('launch', { limit: 5 })
    expect(trace).toMatchObject({
      recipeId: 'launch-recipe',
      retrieverId: 'docs',
      query: 'launch',
      resultCount: 1,
      warnings: [],
      errors: [],
      steps: [
        {
          stepId: 'retrieve',
          kind: 'retrieve',
          status: 'success',
          inputQueryCount: 1,
          outputHitCount: 1,
        },
      ],
    })
  })

  it('fails fast for invalid recipe configuration', () => {
    const { retriever } = baseRetriever({})

    expect(() =>
      retrievalRecipe({
        id: 'docs',
        retriever,
        steps: [retrieve()],
      }),
    ).toThrow('Retrieval recipe id must be distinct from retriever id')

    expect(() =>
      retrievalRecipe({
        id: 'needs-model',
        retriever,
        steps: [retrieve(), rerank()],
      }),
    ).toThrow('Retrieval step "rerank" requires a model')

    expect(() =>
      retrievalRecipe({
        id: 'reserved-id',
        retriever,
        steps: [
          retrievalStep({
            id: 'retrieve',
            phase: { in: 'queries', out: 'queries' },
            run: ({ queries }) => ({ queries }),
          }),
        ],
      }),
    ).toThrow('Retrieval step id "retrieve" is reserved')
  })

  it('captures a failed step trace before surfacing the error', async () => {
    const { retriever } = baseRetriever({
      launch: [hit('doc-1/a', 'Launch checklist')],
    })
    const recipe = retrievalRecipe({
      id: 'failing-recipe',
      retriever,
      steps: [
        retrieve(),
        retrievalStep({
          id: 'explode',
          kind: 'validate',
          phase: { in: 'hits', out: 'hits' },
          run: () => {
            throw new Error('boom')
          },
        }),
      ],
    })

    await expect(recipe.retrieveWithTrace('launch')).rejects.toMatchObject({
      name: 'RetrievalRunError',
      code: 'step_failed',
      trace: {
        recipeId: 'failing-recipe',
        steps: [
          { stepId: 'retrieve', status: 'success' },
          { stepId: 'explode', status: 'error', error: { message: 'boom' } },
        ],
      } satisfies Partial<RecipeTrace>,
    })
  })

  it('creates grounding backed by the recipe retriever', async () => {
    const { retriever } = baseRetriever({
      launch: [hit('doc-1/a', 'Launch checklist')],
    })
    const recipe = retrievalRecipe({
      id: 'launch-recipe',
      retriever,
      steps: [retrieve({ limit: 5 })],
    })

    const grounded = recipe.asGrounding({
      query: ({ input }) => input.question as string,
      limit: 1,
    })

    await expect(grounded.resolve({ question: 'launch' })).resolves.toMatchObject({
      groundingId: 'grounding:launch-recipe',
      retrieverId: 'launch-recipe',
      hits: [expect.objectContaining({ sourceId: 'doc-1', content: 'Launch checklist' })],
    })
  })

  it('runs fanout retrieval concurrently and keeps fused score provenance structured', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const retrieveFn = vi.fn(async (query: string) => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 10))
      inFlight -= 1
      return {
        refund: [hit('doc-1/a', 'Refund overview', 0.7), hit('doc-2/b', 'Billing details', 0.95)],
        'refund policy': [hit('doc-1/a', 'Refund overview', 0.6), hit('doc-3/c', 'Policy details', 0.8)],
        'returns policy': [hit('doc-4/d', 'Returns details', 0.9), hit('doc-1/a', 'Refund overview', 0.5)],
      }[query] ?? []
    })
    const docs = makeRetriever({
      id: 'docs',
      namespace: 'docs',
      retrieve: retrieveFn,
    })
    const model: RetrievalModel = {
      generateText: vi.fn(async () => ({
        text: ['refund policy', 'returns policy', 'refund policy'].join('\n'),
      })),
      generateObject: vi.fn(),
    }

    const recipe = retrievalRecipe({
      id: 'fanout-recipe',
      retriever: docs,
      model,
      concurrency: 2,
      steps: [fanout({ maxQueries: 3 }), retrieve()],
    })

    const { hits, trace } = await recipe.retrieveWithTrace('refund')

    expect(retrieveFn.mock.calls.map(([query]) => query)).toEqual(['refund', 'refund policy', 'returns policy'])
    expect(maxInFlight).toBe(2)
    expect(hits[0]).toMatchObject({
      sourceId: 'doc-1',
      chunkId: 'a',
      score: expect.any(Number),
      provenance: {
        rawScore: 0.7,
        matchedQueries: ['refund', 'refund policy', 'returns policy'],
        ranks: [1, 1, 2],
        fusedScore: expect.any(Number),
      },
    })
    expect(hits[0].score).toBe(hits[0].provenance?.fusedScore)
    expect(hits[0].metadata).not.toHaveProperty('_cruxRetrieval')
    expect(trace.steps.map((step) => step.stepId)).toEqual(['fanout', 'retrieve'])
  })

  it('expands parents, reranks hits, and compresses content with structured provenance', async () => {
    const records = inMemoryRecordStore()
    const indexed = createIndexedKnowledgeStore({ indexerId: 'docs', namespace: 'docs', records })
    await indexed.persistGeneration({
      chunks: [],
      parents: [
        {
          namespace: 'docs',
          sourceId: 'pricing',
          parentId: 'parent-1',
          ordinal: 0,
          content: 'Pricing guide parent content with enterprise discount rules.',
          metadata: { title: 'Pricing Guide' },
        },
      ],
      replaceSources: false,
    })
    const { retriever } = baseRetriever({
      pricing: [
        {
          ...hit('pricing/a', 'Relevant setup sentence. Extra irrelevant detail.', 0.5),
          parent: { parentId: 'parent-1' },
        },
        hit('billing/b', 'No useful content', 0.9),
      ],
    })
    const model: RetrievalModel = {
      generateText: vi.fn(async () => ({ text: '' })),
      generateObject: vi.fn(async ({ prompt, schema }) => {
        if (prompt.includes('Return up to')) {
          return {
            object: schema.parse({
              rankings: [
                { index: 0, score: 0.97 },
                { index: 1, score: 0.12 },
              ],
            }),
          }
        }
        return {
          object: schema.parse({
            hits: [
              { sourceId: 'pricing', chunkId: 'a', excerpts: ['Relevant setup sentence.'] },
              { sourceId: 'billing', chunkId: 'b', excerpts: [] },
            ],
          }),
        }
      }),
    }

    const { expandParents, compressToBudget } = await import('../../retrieval')
    const recipe = retrievalRecipe({
      id: 'hit-stage-recipe',
      retriever,
      model,
      steps: [
        retrieve(),
        expandParents({ records, indexerId: 'docs' }),
        rerank({ topK: 1 }),
        compressToBudget({ tokens: 500 }),
      ],
    })

    const hits = await recipe.retrieve('pricing')

    expect(hits).toEqual([
      expect.objectContaining({
        sourceId: 'pricing',
        chunkId: 'a',
        content: 'Relevant setup sentence.',
        score: 0.97,
        parent: expect.objectContaining({
          parentId: 'parent-1',
          content: expect.stringContaining('Pricing guide parent content'),
          metadata: { title: 'Pricing Guide' },
        }),
        provenance: expect.objectContaining({
          rawScore: 0.5,
          rerankScore: 0.97,
          compression: {
            originalLength: 'Relevant setup sentence. Extra irrelevant detail.'.length,
            compressedLength: 'Relevant setup sentence.'.length,
          },
        }),
        metadata: {},
      }),
    ])
    expect(hits[0].metadata).not.toHaveProperty('_cruxCompression')
  })
})
