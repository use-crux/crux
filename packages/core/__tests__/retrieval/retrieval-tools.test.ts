import { describe, expect, it } from 'vitest'
import { embedding as makeEmbedding } from '../../embedding'
import { indexer as makeIndexer } from '../../indexing'
import { prompt } from '../../prompt/prompt'
import { RETRIEVAL_HITS_KIND, retriever as makeRetriever } from '../../retrieval'
import { inMemoryRecordStore, inMemoryVectorStore } from '../../storage'

function createDenseEmbedding() {
  return makeEmbedding({
    kind: 'dense',
    name: 'test-dense',
    dimensions: 2,
    maxInputTokens: 100,
    batch: { maxSize: 8 },
    embed: async (texts) => texts.map((text) => [text.length, text.length / 2]),
  })
}

describe('retriever tools', () => {
  it('injects a typed search tool by default when used directly in a prompt', async () => {
    const retriever = makeRetriever({
      id: 'docs',
      namespace: 'docs',
      retrieve: async () => [
        {
          namespace: 'docs',
          sourceId: 'doc-1',
          chunkId: '0',
          content: 'Release notes',
          metadata: {},
          score: 0.93,
        },
      ],
    })
    const answer = prompt({ use: [retriever], system: 'Base.' })

    const resolved = await answer.resolve({})

    expect(resolved.system).toBe('Base.')
    expect(resolved.tools?.search).toBeDefined()
    const payload = await resolved.tools!.search.execute({ query: 'release', limit: 1 })
    expect(payload).toMatchObject({
      kind: RETRIEVAL_HITS_KIND,
      hits: [
        {
          namespace: 'docs',
          sourceId: 'doc-1',
          chunkId: '0',
          content: 'Release notes',
          score: 0.93,
        },
      ],
    })
    const modelOutput = await resolved.tools!.search.toModelOutput?.({
      toolCallId: 'call-1',
      input: { query: 'release', limit: 1 },
      output: payload,
    })
    expect(modelOutput).toEqual({
      type: 'text',
      value: '[doc-1/0] (0.93) Release notes',
    })
  })

  it('exposes search payloads and rejects getSource without store or session visibility', async () => {
    const retriever = makeRetriever({
      id: 'r1',
      namespace: 'docs',
      retrieve: async (query, options) => [
        {
          namespace: 'docs',
          sourceId: 'doc-4',
          chunkId: '1',
          content: `${query}:${options.limit}`,
          metadata: { kind: 'note' },
          score: 0.7,
        },
      ],
    })

    const tools = retriever.asTools({ include: ['search', 'getSource'] })

    expect(Object.keys(tools)).toEqual(['search', 'getSource'])
    expect(tools.search.parameters.safeParse({ query: 'ops', limit: 2 }).success).toBe(true)
    await expect(
      tools.search.execute({ query: 'ops', limit: 2, filter: { topic: 'launch' } }),
    ).resolves.toEqual({
      kind: RETRIEVAL_HITS_KIND,
      hits: [
        {
          namespace: 'docs',
          sourceId: 'doc-4',
          chunkId: '1',
          content: 'ops:2',
          score: 0.7,
        },
      ],
    })
    await expect(tools.getSource.execute({ sourceId: 'doc-4', chunkId: '1' })).rejects.toThrow(
      'getSource requires a store-backed retriever or grounding session',
    )
  })

  it('reads active source chunks through store-backed getSource namespace visibility', async () => {
    const records = inMemoryRecordStore()
    const vectors = inMemoryVectorStore()
    const dense = createDenseEmbedding()
    const indexer = makeIndexer({
      id: 'docs',
      namespace: 'docs',
      records,
      vectors,
      dense,
    })
    await indexer.indexDocuments([
      {
        namespace: 'docs',
        sourceId: 'guide.md',
        content: 'Store-backed source body',
      },
    ])
    const retriever = makeRetriever({
      id: 'docs',
      namespace: 'docs',
      records,
      vectors,
      dense,
    })

    const tools = retriever.asTools({
      include: ['getSource'],
      getSource: { visibility: 'namespace' },
    })
    const page = await records.list('indexer:docs:namespace:docs:source:guide.md:chunk:')
    const chunkId = page.entries[0].value.chunkId
    expect(typeof chunkId).toBe('string')

    await expect(tools.getSource.execute({ sourceId: 'guide.md', chunkId })).resolves.toMatchObject({
      kind: RETRIEVAL_HITS_KIND,
      hits: [
        {
          namespace: 'docs',
          sourceId: 'guide.md',
          chunkId,
          content: 'Store-backed source body',
        },
      ],
    })
  })
})
