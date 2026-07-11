import { afterEach, describe, expect, it } from 'vitest'
import {
  judgeReranker,
  rerank,
  retrievalRecipe,
  retrieve,
  retriever as makeRetriever,
  type RetrievalModel,
  type RetrieverHit,
} from '../../src/retrieval'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '../../src/observability'
import type { DefinitionRef } from '../../src/observability'

type Transport = ReturnType<typeof createInMemoryObservabilityTransport>

function startRecords(transport: Transport, primitive: string) {
  return transport.records.filter(
    (record) => record.type === 'span:start' && record.primitive === primitive,
  ) as Array<{
    primitive: string
    name?: string
    attributes?: Record<string, unknown>
    definitionRefs?: DefinitionRef[]
  }>
}

function hit(id: string, content: string, score = 1): RetrieverHit {
  return {
    namespace: 'docs',
    sourceId: id,
    chunkId: '0',
    content,
    metadata: {},
    score,
    provenance: { rawScore: score },
  }
}

const scriptedModel: RetrievalModel = {
  generateText: async () => ({ text: '' }),
  generateObject: async ({ schema }) => ({
    object: schema.parse({ rankings: [{ index: 0, score: 0.9 }] }),
  }),
}

describe('retrieval recipe/reranker spans emit canonical definition refs', () => {
  afterEach(() => {
    resetObservabilityRuntime()
  })

  it('emits rag.recipe on the recipe span and rag.reranker on the rerank step span', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const docs = makeRetriever({
      id: 'docs',
      namespace: 'docs',
      retrieve: async () => [hit('a', 'Alpha'), hit('b', 'Beta')],
    })
    const engine = judgeReranker({ name: 'cross-encoder', model: scriptedModel })
    const recipe = retrievalRecipe({
      id: 'hybrid-search',
      retriever: docs,
      steps: [retrieve(), rerank({ engine, topK: 1 })],
    })

    await recipe.retrieve('alpha')
    await observe.flush()

    const recipeSpans = startRecords(transport, 'retrieval.recipe')
    expect(recipeSpans[0]?.definitionRefs).toEqual([
      { id: 'rag.recipe:hybrid-search', kind: 'rag.recipe', role: 'invoked-recipe' },
    ])

    const stepSpans = startRecords(transport, 'retrieval.step')
    const rerankStep = stepSpans.find((s) => s.attributes?.stepKind === 'rerank')
    // The reranker ref targets the authored engine name, not the step label.
    expect(rerankStep?.definitionRefs).toEqual([
      { id: 'rag.reranker:cross-encoder', kind: 'rag.reranker', role: 'invoked-reranker' },
    ])

    // A non-reranker step (retrieve) carries no rag.reranker evidence.
    const retrieveStep = stepSpans.find((s) => s.attributes?.stepKind === 'retrieve')
    expect(retrieveStep?.definitionRefs).toBeUndefined()
  })
})
