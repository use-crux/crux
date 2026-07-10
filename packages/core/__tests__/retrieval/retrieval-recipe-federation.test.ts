import { describe, expect, it, vi } from 'vitest'
import { retriever as makeRetriever, retrievalRecipe, retrieve } from '../../src/retrieval'
import type { RecipeTrace, RetrieverHit } from '../../src/retrieval'

function sourceHit(
  namespace: string,
  id: string,
  content: string,
  score = 1,
  metadata: Record<string, unknown> = {},
): RetrieverHit {
  return {
    namespace,
    sourceId: id.split('/')[0] ?? id,
    chunkId: id.split('/')[1] ?? '0',
    content,
    metadata,
    score,
    provenance: { rawScore: score },
  }
}

describe('retrievalRecipe federation', () => {
  it('federates retrievers with source weights and dedupes hits by source identity', async () => {
    const primary = makeRetriever({
      id: 'primary-docs',
      namespace: 'docs',
      retrieve: vi.fn(async () => [
        sourceHit('docs', 'shared/a', 'Shared answer from primary', 0.4),
        sourceHit('docs', 'primary-only/b', 'Primary-only answer', 0.99),
      ]),
    })
    const secondary = makeRetriever({
      id: 'secondary-docs',
      namespace: 'docs',
      retrieve: vi.fn(async () => [
        sourceHit('docs', 'secondary-only/c', 'Secondary-only answer', 0.98),
        sourceHit('docs', 'shared/a', 'Shared answer from secondary', 0.7),
      ]),
    })

    const recipe = retrievalRecipe({
      id: 'federated-recipe',
      retriever: [
        { retriever: primary, weight: 3 },
        { retriever: secondary, weight: 1 },
      ],
      steps: [retrieve({ limit: 5 })],
    })

    const { hits, trace } = await recipe.retrieveWithTrace('refund')

    expect(hits.map((item) => `${item.sourceId}/${item.chunkId}`)).toEqual([
      'shared/a',
      'primary-only/b',
      'secondary-only/c',
    ])
    expect(hits[0]).toMatchObject({
      namespace: 'docs',
      sourceId: 'shared',
      chunkId: 'a',
      score: expect.any(Number),
      provenance: {
        rawScore: 0.7,
        matchedQueries: ['refund'],
        ranks: [1, 2],
        fusedScore: expect.any(Number),
        perSource: [
          { retrieverId: 'primary-docs', score: 0.4, rank: 1, weight: 3 },
          { retrieverId: 'secondary-docs', score: 0.7, rank: 2, weight: 1 },
        ],
      },
    })
    expect(hits[0].score).toBe(hits[0].provenance?.fusedScore)
    expect(trace.steps[0]).toMatchObject({
      stepId: 'retrieve',
      status: 'success',
      sources: [
        { retrieverId: 'primary-docs', namespace: 'docs', status: 'success', queryCount: 1, hitCount: 2, weight: 3 },
        { retrieverId: 'secondary-docs', namespace: 'docs', status: 'success', queryCount: 1, hitCount: 2, weight: 1 },
      ],
    })
  })

  it('skips failed federated sources with warnings when configured', async () => {
    const stable = makeRetriever({
      id: 'stable-docs',
      namespace: 'docs',
      retrieve: vi.fn(async () => [sourceHit('docs', 'stable/a', 'Stable answer', 0.8)]),
    })
    const broken = makeRetriever({
      id: 'broken-docs',
      namespace: 'docs',
      retrieve: vi.fn(async () => {
        throw new Error('vector store unavailable')
      }),
    })

    const recipe = retrievalRecipe({
      id: 'federated-warning-recipe',
      retriever: [stable, broken],
      onSourceError: 'skip-with-warning',
      steps: [retrieve()],
    })

    const { hits, trace } = await recipe.retrieveWithTrace('refund')

    expect(hits).toEqual([expect.objectContaining({ sourceId: 'stable', chunkId: 'a' })])
    expect(trace.warnings).toEqual([
      'Retrieval source "broken-docs" failed and was skipped: vector store unavailable',
    ])
    expect(trace.steps[0]).toMatchObject({
      stepId: 'retrieve',
      status: 'success',
      sources: [
        { retrieverId: 'stable-docs', status: 'success', queryCount: 1, hitCount: 1 },
        {
          retrieverId: 'broken-docs',
          status: 'skipped',
          queryCount: 1,
          hitCount: 0,
          warnings: ['vector store unavailable'],
          error: { message: 'vector store unavailable', name: 'Error' },
        },
      ],
    })
  })

  it('fails federated retrieval by default when a source fails', async () => {
    const stable = makeRetriever({
      id: 'stable-docs',
      namespace: 'docs',
      retrieve: vi.fn(async () => [sourceHit('docs', 'stable/a', 'Stable answer', 0.8)]),
    })
    const broken = makeRetriever({
      id: 'broken-docs',
      namespace: 'docs',
      retrieve: vi.fn(async () => {
        throw new Error('vector store unavailable')
      }),
    })

    const recipe = retrievalRecipe({
      id: 'federated-fail-recipe',
      retriever: [stable, broken],
      steps: [retrieve()],
    })

    await expect(recipe.retrieveWithTrace('refund')).rejects.toMatchObject({
      name: 'RetrievalRunError',
      code: 'source_failed',
      trace: {
        recipeId: 'federated-fail-recipe',
        steps: [
          {
            stepId: 'retrieve',
            status: 'error',
            error: { message: 'Retrieval source "broken-docs" failed.', name: 'RetrievalRunError' },
          },
        ],
      } satisfies Partial<RecipeTrace>,
    })
  })

  it('runs federated sources concurrently under the recipe concurrency cap', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const makeSlowRetriever = (id: string) =>
      makeRetriever({
        id,
        namespace: 'docs',
        retrieve: vi.fn(async () => {
          inFlight += 1
          maxInFlight = Math.max(maxInFlight, inFlight)
          await new Promise((resolve) => setTimeout(resolve, 10))
          inFlight -= 1
          return [sourceHit('docs', `${id}/a`, `${id} answer`, 0.8)]
        }),
      })

    const first = makeSlowRetriever('first-docs')
    const second = makeSlowRetriever('second-docs')
    const third = makeSlowRetriever('third-docs')

    const recipe = retrievalRecipe({
      id: 'federated-concurrency-recipe',
      retriever: [first, second, third],
      concurrency: 2,
      steps: [retrieve()],
    })

    await recipe.retrieve('refund')

    expect(maxInFlight).toBe(2)
  })
})
