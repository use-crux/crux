import { afterEach, describe, expect, it, vi } from 'vitest'
import { EmbeddingModalityError, EmbeddingSpaceMismatchError, embedding } from '../../src/embedding'
import { indexedEmbeddingSpaceKey } from '../../src/indexed-knowledge/embedding-space'
import { indexer } from '../../src/indexing'
import { retriever, retrievalRecipe, retrievalStep, retrieve } from '../../src/retrieval'
import { inMemoryStorage } from '../../src/storage'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '../../src/observability'

const image = {
  type: 'data' as const,
  data: new Uint8Array([1, 2, 3]),
  mediaType: 'image/png',
}

describe('multimodal retrieval rules', () => {
  afterEach(() => resetObservabilityRuntime())

  it('passes query roles and memoizes the namespace-space read', async () => {
    const storage = inMemoryStorage()
    const provider = vi.fn(async () => [[1, 0]])
    const dense = embedding({
      kind: 'dense',
      name: 'role-space',
      dimensions: 2,
      maxInputTokens: 100,
      modalities: ['text', 'image'],
      batch: { maxSize: 8 },
      embed: provider,
    })
    await indexer({ id: 'docs', namespace: 'docs', storage, dense }).indexDocuments([
      { namespace: 'docs', sourceId: 'guide', content: 'dog guide' },
    ])
    provider.mockClear()
    const get = vi.spyOn(storage.records, 'get')
    const search = retriever({ id: 'docs', namespace: 'docs', storage, dense })

    await search.retrieve('dog')
    await search.retrieve('dog again')

    expect(provider).toHaveBeenCalledTimes(2)
    expect(provider.mock.calls.map((call) => call[1])).toEqual([
      { role: 'query' },
      { role: 'query' },
    ])
    const spaceKey = indexedEmbeddingSpaceKey('docs')
    expect(get.mock.calls.filter(([key]) => key === spaceKey)).toHaveLength(1)
  })

  it('uses vector metadata as a post-search guard for legacy namespaces', async () => {
    const storage = inMemoryStorage()
    const indexed = fakeDense('indexed-space')
    await indexer({ id: 'docs', namespace: 'docs', storage, dense: indexed }).indexDocuments([
      { namespace: 'docs', sourceId: 'guide', content: 'dog guide' },
    ])
    await storage.records.delete(indexedEmbeddingSpaceKey('docs'))

    const queryProvider = vi.fn(async () => [[1, 0]])
    const configured = fakeDense('configured-space', queryProvider)
    const searchSpy = vi.spyOn(storage.search!, 'search')
    const search = retriever({ id: 'docs', namespace: 'docs', storage, dense: configured })

    await expect(search.retrieve('dog')).rejects.toBeInstanceOf(EmbeddingSpaceMismatchError)
    expect(queryProvider).toHaveBeenCalledOnce()
    expect(searchSpy).toHaveBeenCalledOnce()
  })

  it('rejects media for sparse and custom retrievers before their implementations run', async () => {
    const storage = inMemoryStorage()
    const sparseProvider = vi.fn(async () => [{ indices: [0], values: [1] }])
    const sparse = embedding({
      kind: 'sparse',
      name: 'text-sparse',
      maxInputTokens: 100,
      batch: { maxSize: 8 },
      embed: sparseProvider,
    })
    const searchSpy = vi.spyOn(storage.search!, 'search')
    const sparseSearch = retriever({ id: 'sparse', namespace: 'docs', storage, sparse })

    await expect(sparseSearch.retrieve(image as never)).rejects.toBeInstanceOf(EmbeddingModalityError)
    expect(sparseProvider).not.toHaveBeenCalled()
    expect(searchSpy).not.toHaveBeenCalled()

    const customImplementation = vi.fn(async () => [])
    const custom = retriever({
      id: 'custom',
      namespace: 'docs',
      retrieve: customImplementation,
    })
    await expect(custom.retrieve(image as never)).rejects.toThrow('accepts text queries only')
    expect(customImplementation).not.toHaveBeenCalled()
  })

  it('keeps media recipe traces byte-free and rejects text-planning steps', async () => {
    const storage = inMemoryStorage()
    const dense = fakeDense('recipe-space')
    await indexer({ id: 'docs', namespace: 'docs', storage, dense }).indexDocuments([
      { namespace: 'docs', sourceId: 'photo', asset: image },
    ])
    const search = retriever({ id: 'docs', namespace: 'docs', storage, dense })
    const direct = retrievalRecipe({ id: 'direct', retriever: search, steps: [retrieve()] })

    const result = await direct.retrieveWithTrace(image)
    expect(result.trace).toMatchObject({
      query: '<media:image>',
      input: { query: '<media:image>' },
    })
    expect(JSON.stringify(result.trace)).not.toContain('1,2,3')

    const planningStep = retrievalStep({
      id: 'rewrite-media',
      kind: 'rewrite-query',
      phase: { in: 'queries', out: 'queries' },
      run: (input) => input,
    })
    const planned = retrievalRecipe({
      id: 'planned',
      retriever: search,
      steps: [planningStep, retrieve()],
    })
    await expect(planned.retrieve(image)).rejects.toThrow('cannot rewrite or fan out a media query')
  })

  it('keeps provider media errors out of recipe traces and observability records', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const storage = inMemoryStorage()
    const providerError = new Error(
      'data:image/png;base64,c2VjcmV0 https://cdn.example/dog?signature=signed-secret provider-file-secret private.png',
    )
    const dense = embedding({
      kind: 'dense',
      name: 'recipe-error-space',
      dimensions: 2,
      maxInputTokens: 100,
      modalities: ['text', 'image'],
      batch: { maxSize: 8 },
      embed: async (inputs, context) => {
        if (context.role === 'query') throw providerError
        return inputs.map(() => [1, 0])
      },
    })
    await indexer({ id: 'docs', namespace: 'docs', storage, dense }).indexDocuments([
      { namespace: 'docs', sourceId: 'photo', asset: image },
    ])
    const search = retriever({ id: 'docs', namespace: 'docs', storage, dense })
    const recipe = retrievalRecipe({ id: 'safe-errors', retriever: search, steps: [retrieve()] })

    let trace: unknown
    await expect(observe.run(
      { name: 'retrieve private image', rootPrimitive: 'retrieval.recipe' },
      async () => {
        try {
          await recipe.retrieveWithTrace(image)
        } catch (error) {
          trace = error instanceof Error && 'trace' in error ? error.trace : undefined
          throw error
        }
      },
    )).rejects.toThrow('Retrieval source "docs" failed.')
    await observe.flush()

    const evidence = JSON.stringify({ trace, records: transport.records })
    expect(evidence).toContain('Embedding provider call failed for media input.')
    expect(evidence).not.toMatch(/c2VjcmV0|signed-secret|provider-file-secret|private\.png/)
  })

  it('renders empty media hits as attribution without a blank content suffix', async () => {
    const search = retriever({
      id: 'custom',
      namespace: 'docs',
      retrieve: async () => [{
        namespace: 'docs',
        source: { id: 'photo', mediaType: 'image/png' },
        chunkId: '0',
        content: '',
        metadata: {},
        score: 1,
      }],
      context: { query: 'dog' },
    })

    const system = await search.asContext().systemFn({})
    expect(system).toBe('## Retrieved Context (dog)\n- [photo/0] (score: 1.00)')
  })
})

function fakeDense(name: string, provider = vi.fn(async () => [[1, 0]])) {
  return embedding({
    kind: 'dense',
    name,
    dimensions: 2,
    maxInputTokens: 100,
    modalities: ['text', 'image'],
    batch: { maxSize: 8 },
    embed: provider,
  })
}
