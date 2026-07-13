import { describe, expect, it, vi } from 'vitest'
import {
  judgeReranker,
  rerank,
  retrievalRecipe,
  retrieve,
  retriever as makeRetriever,
  type RetrievalModel,
  type RetrieverHit,
} from '../../src/retrieval'

function hit(id: string, content: string, score = 1): RetrieverHit {
  return {
    namespace: 'docs',
    source: { id: id.split('/')[0] ?? id },
    chunkId: id.split('/')[1] ?? '0',
    content,
    metadata: {},
    score,
    provenance: { rawScore: score },
  }
}

describe('retrieval reranking', () => {
  it('judgeReranker ranks by model-returned indexes without dropping omitted hits', async () => {
    const model: RetrievalModel = {
      generateText: vi.fn(),
      generateObject: vi.fn(async ({ prompt, schema }) => {
        expect(prompt).toContain('[0] Alpha setup')
        expect(prompt).toContain('[1] Billing policy')
        expect(prompt).not.toContain('sourceId')
        return {
          object: schema.parse({
            rankings: [
              { index: 1, score: 0.91 },
              { index: 99, score: 1 },
              { index: 1, score: 0.2 },
            ],
          }),
        }
      }),
    }
    const reranker = judgeReranker({ model, name: 'judge', document: (item) => item.content })

    const hits = await reranker.rerank({
      query: 'billing',
      hits: [hit('a/1', 'Alpha setup', 0.3), hit('b/2', 'Billing policy', 0.7), hit('c/3', 'Contact page', 0.2)],
    })

    expect(hits.map((item) => item.source.id)).toEqual(['b', 'a', 'c'])
    expect(hits[0]).toMatchObject({
      score: 0.91,
      provenance: { rawScore: 0.7, rerankScore: 0.91 },
    })
    expect(hits[1]).toMatchObject({ score: 0.3, provenance: { rawScore: 0.3 } })
    expect(hits[2]).toMatchObject({ score: 0.2, provenance: { rawScore: 0.2 } })
  })

  it('rerank({ engine }) does not require a recipe model and records rerank provenance', async () => {
    const docs = makeRetriever({
      id: 'docs',
      namespace: 'docs',
      retrieve: async () => [hit('a/1', 'Alpha setup', 0.3), hit('b/2', 'Billing policy', 0.7)],
    })
    const engine = {
      name: 'scripted',
      rerank: vi.fn(async ({ hits }: { query: string; hits: readonly RetrieverHit[] }) => [
        { ...hits[1], score: 0.92 },
        { ...hits[0], score: 0.2 },
      ]),
    }
    const recipe = retrievalRecipe({
      id: 'engine-rerank',
      retriever: docs,
      steps: [retrieve(), rerank({ engine, topK: 1 })],
    })

    const hits = await recipe.retrieve('billing')

    expect(engine.rerank).toHaveBeenCalledWith({
      query: 'billing',
      hits: expect.arrayContaining([expect.objectContaining({ source: { id: 'a' } })]),
    })
    expect(hits).toEqual([
      expect.objectContaining({
        source: { id: 'b' },
        score: 0.92,
        provenance: expect.objectContaining({ rawScore: 0.7, rerankScore: 0.92 }),
      }),
    ])
  })
})
