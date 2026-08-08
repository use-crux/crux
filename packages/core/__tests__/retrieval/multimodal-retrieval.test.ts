import { describe, expect, it, vi } from 'vitest'
import type { StoredAsset } from '../../src/asset'
import { EmbeddingSpaceMismatchError, embedding } from '../../src/embedding'
import { indexer } from '../../src/indexing'
import { knowledgeBase, retriever, retrievalRecipe, retrieve } from '../../src/retrieval'
import { inMemoryStorage } from '../../src/storage'
import { schema2MediaDocument, schema2TextDocument } from '../fixtures/schema2-stored-evidence'

const dogPhoto = dataImage([100, 111, 103])
const otherPhoto = dataImage([99, 97, 116])

describe('multimodal retrieval dog proof', () => {
  it('retrieves across text and image while keeping persisted state byte-safe', async () => {
    const storage = inMemoryStorage()
    const dense = semanticFake('dog-space', 2)
    const products = knowledgeBase({ id: 'products', storage, embeddings: dense })

    await products.index([
      schema2MediaDocument({ namespace: 'products', sourceId: 'rex', title: 'Rex', asset: dogPhoto }),
      schema2TextDocument({ namespace: 'products', sourceId: 'cat-faq', content: 'A cat adoption guide' }),
      schema2MediaDocument({ namespace: 'products', sourceId: 'cat-photo', asset: otherPhoto }),
    ])
    const search = products.retriever()

    const textHits = await search.retrieve('dog')
    expect(textHits[0]).toMatchObject({
      source: {
        id: 'rex',
        assetRef: { uri: expect.stringMatching(/^memory:\/\/asset\//) },
        mediaType: 'image/png',
      },
      content: '',
    })
    const stored = (await storage.assets?.get(textHits[0].source.assetRef!)) as StoredAsset
    expect(stored.type).toBe('data')
    expect([...((stored as Extract<StoredAsset, { type: 'data' }>).data as Uint8Array)]).toEqual([100, 111, 103])

    const imageToImageHits = await search.retrieve(dogPhoto)
    expect(imageToImageHits[0]).toEqual(expect.objectContaining({ source: expect.objectContaining({ id: 'rex' }) }))

    await products.index([schema2TextDocument({ namespace: 'products', sourceId: 'dog-faq', content: 'A brown dog' })])
    const imageHits = await search.retrieve(dogPhoto)
    expect(imageHits.map((hit) => hit.source.id).slice(0, 2)).toEqual(['dog-faq', 'rex'])

    const records = (await storage.records.list('indexer:products:namespace:products:')).entries
    const serializedRecords = JSON.stringify(records)
    expect(serializedRecords).not.toMatch(/"media"|100,111,103|99,97,116|base64|fileId|filename/)
    const searchHits = await storage.search?.search({ legs: [{ kind: 'dense', vector: [1, 0] }], limit: 10 })
    expect(JSON.stringify(searchHits)).not.toMatch(/100,111,103|99,97,116|base64|fileId|filename/)
  })

  it('supports bare media through recipes and uses dense-only hybrid provenance', async () => {
    const storage = inMemoryStorage()
    const dense = semanticFake('hybrid-space', 2)
    const sparseProvider = vi.fn(async (texts: string[]) => texts.map(() => ({ indices: [0], values: [1] })))
    const sparse = embedding({
      kind: 'sparse',
      name: 'sparse',
      maxInputTokens: 100,
      batch: { maxSize: 8 },
      embed: sparseProvider,
    })
    await indexer({
      id: 'products',
      namespace: 'products',
      storage,
      dense,
      sparse,
    }).indexDocuments([schema2MediaDocument({ namespace: 'products', sourceId: 'rex', asset: dogPhoto })])
    const hybrid = retriever({
      id: 'products',
      namespace: 'products',
      storage,
      dense,
      sparse,
    })
    const recipe = retrievalRecipe({
      id: 'product-search',
      retriever: hybrid,
      steps: [retrieve()],
    })

    const direct = await hybrid.retrieve(dogPhoto, { search: { dense: true } })
    const throughRecipe = await recipe.retrieve(dogPhoto, { search: { dense: true } })

    expect(direct[0].provenance?.matchedQueries).toEqual(['<media:image>'])
    expect(throughRecipe[0].source.id).toBe('rex')
    expect(sparseProvider).not.toHaveBeenCalled()
  })

  it('rejects a mismatched retriever before query embedding or search', async () => {
    const storage = inMemoryStorage()
    const indexed = semanticFake('indexed-space', 2)
    await indexer({ id: 'products', namespace: 'products', storage, dense: indexed }).indexDocuments([
      schema2MediaDocument({ namespace: 'products', sourceId: 'rex', asset: dogPhoto }),
    ])
    const queryProvider = vi.fn(async () => [[1, 0, 0]])
    const query = embedding({
      kind: 'dense',
      name: 'query-space',
      dimensions: 3,
      maxInputTokens: 100,
      modalities: ['text', 'image'],
      batch: { maxSize: 8 },
      embed: queryProvider,
    })
    const searchSpy = vi.spyOn(storage.search!, 'search')
    const mismatched = retriever({
      id: 'products',
      namespace: 'products',
      storage,
      dense: query,
    })

    await expect(mismatched.retrieve('dog')).rejects.toBeInstanceOf(EmbeddingSpaceMismatchError)
    expect(queryProvider).not.toHaveBeenCalled()
    expect(searchSpy).not.toHaveBeenCalled()
  })
})

function semanticFake(name: string, dimensions: number) {
  return embedding({
    kind: 'dense',
    name,
    dimensions,
    maxInputTokens: 100,
    modalities: ['text', 'image'],
    batch: { maxSize: 8 },
    embed: async (inputs) =>
      inputs.map((input) => {
        if (input.type === 'text') return /dog/i.test(input.text) ? [1, 0] : [0, 1]
        if (input.asset.type !== 'data') return [0, 1]
        const bytes = input.asset.data as Uint8Array
        return bytes[0] === 100 ? [1, 0] : [0, 1]
      }),
  })
}

function dataImage(bytes: readonly number[]) {
  return {
    type: 'data' as const,
    data: new Uint8Array(bytes),
    mediaType: 'image/png',
  }
}
