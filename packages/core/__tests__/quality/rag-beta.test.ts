import { describe, expect, it } from 'vitest'
import { evaluate, scorers, target } from '../../quality'
import { retrievalRecipe, retrieve, retriever, type RetrieverHit } from '../../retrieval'
import { runEvaluationWithRunner as run } from './runner-harness'

function hit(sourceId: string, chunkId: string, score: number): RetrieverHit {
  return {
    namespace: 'docs',
    sourceId,
    chunkId,
    content: `${sourceId}/${chunkId}`,
    metadata: {},
    score,
  }
}

const expectedSources = (...sources: Array<{ sourceId: string; chunkId?: string }>) => ({ sources })

describe('scorers.rag deterministic metrics', () => {
  it('scores recall@k, MRR, expected source coverage, and context precision from retrieved sources', async () => {
    const output = [hit('intro', 'a', 0.9), hit('refunds', 'b', 0.8), hit('billing', 'c', 0.7)]
    const expected = expectedSources({ sourceId: 'refunds', chunkId: 'b' }, { sourceId: 'shipping' })

    expect(
      await scorers.rag.recallAtK(2)({
        input: { query: 'refunds' },
        output,
        expected,
      }),
    ).toMatchObject({
      name: 'rag.recall@2',
      score: 0.5,
    })
    expect(
      await scorers.rag.mrr()({
        input: { query: 'refunds' },
        output,
        expected,
      }),
    ).toMatchObject({
      name: 'rag.mrr',
      score: 0.5,
    })
    expect(
      await scorers.rag.expectedSourceCoverage()({
        input: { query: 'refunds' },
        output,
        expected,
      }),
    ).toMatchObject({
      name: 'rag.expectedSourceCoverage',
      score: 0.5,
    })
    expect(
      await scorers.rag.contextPrecision({ k: 2 })({
        input: {},
        output,
        expected,
      }),
    ).toMatchObject({
      name: 'rag.contextPrecision',
      score: 0.5,
    })
  })

  it('scores citation validity and recipe trace shape without model judges', async () => {
    expect(
      await scorers.rag.citationValidity()({
        input: {},
        output: {
          citations: [
            { sourceId: 'refunds', chunkId: 'b' },
            { sourceId: 'unknown', chunkId: 'x' },
          ],
        },
        expected: expectedSources({ sourceId: 'refunds', chunkId: 'b' }),
      }),
    ).toMatchObject({ name: 'rag.citationValidity', score: 0.5 })

    expect(
      await scorers.rag.traceShapeSnapshot()({
        input: {},
        output: {
          trace: {
            id: 'trace-1',
            recipeId: 'docs-recipe',
            startedAt: 1,
            durationMs: 2,
            input: { query: 'refunds' },
            resultCount: 1,
            steps: [
              {
                stepId: 'retrieve',
                kind: 'retrieve',
                status: 'success',
                durationMs: 1,
                warnings: [],
              },
            ],
            warnings: [],
            errors: [],
          },
        },
        expected: undefined,
      }),
    ).toMatchObject({ name: 'rag.traceShapeSnapshot', score: 1 })
  })

  it('accepts the trace from a real retrieval recipe as the snapshot shape', async () => {
    const base = retriever({
      id: 'docs',
      namespace: 'docs',
      retrieve: async () => [hit('refunds', 'b', 0.9)],
    })
    const recipe = retrievalRecipe({
      id: 'docs-trace',
      retriever: base,
      steps: [retrieve()],
    })
    const result = await recipe.retrieveWithTrace('refunds')

    expect(
      await scorers.rag.traceShapeSnapshot()({
        input: {},
        output: result,
        expected: undefined,
      }),
    ).toMatchObject({
      name: 'rag.traceShapeSnapshot',
      score: 1,
    })
  })
})

describe('evaluate() over retrieval recipes', () => {
  it('runs a recipe task and scores it with public RAG metrics', async () => {
    const base = retriever({
      id: 'docs',
      namespace: 'docs',
      retrieve: async () => [hit('refunds', 'b', 0.9), hit('billing', 'c', 0.7)],
    })
    const recipe = retrievalRecipe({
      id: 'docs-rag',
      retriever: base,
      steps: [retrieve({ limit: 2 })],
    })

    const evaluation = evaluate('docs.rag', {
      task: recipe,
      data: [
        {
          input: { query: 'refund policy' },
          expected: expectedSources({ sourceId: 'refunds', chunkId: 'b' }),
        },
      ],
      scorers: (s) => [s.rag.recallAtK(1), s.rag.mrr()],
      gates: { scores: { 'rag.recall@1': { min: 1 }, 'rag.mrr': { min: 1 } } },
    })

    const experiment = await run(evaluation)
    expect(experiment.passed).toBe(true)
    expect(experiment.cells[0]!.output).toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceId: 'refunds' })]),
    )
    expect(experiment.cells[0]!.scores).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'rag.recall@1', score: 1 }),
        expect.objectContaining({ name: 'rag.mrr', score: 1 }),
      ]),
    )
  })

  it('can wrap a recipe with target.retrievalRecipe for custom query mapping', async () => {
    const base = retriever({
      id: 'docs',
      namespace: 'docs',
      retrieve: async (query) => [hit(query, 'a', 1)],
    })
    const recipe = retrievalRecipe({
      id: 'docs-recipe',
      retriever: base,
      steps: [retrieve()],
    })

    const evaluation = evaluate({
      task: target.retrievalRecipe(recipe, {
        query: (input: { source: string }) => input.source,
      }),
      data: [
        {
          input: { source: 'refunds' },
          expected: expectedSources({ sourceId: 'refunds' }),
        },
      ],
      scorers: (s) => [s.rag.expectedSourceCoverage()],
    })

    const experiment = await run(evaluation)
    expect(experiment.cells[0]!.scores[0]).toMatchObject({
      name: 'rag.expectedSourceCoverage',
      score: 1,
    })
  })
})
