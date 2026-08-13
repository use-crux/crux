import { describe, expect, it } from 'vitest'
import { embedding } from '../../src/embedding'
import { chunker, indexingPipeline } from '../../src/indexing'
import type { DeriveStage } from '../../src/knowledge'
import { knowledgeBase } from '../../src/retrieval'
import { inMemoryStorage } from '../../src/storage'
import { textOf } from '../embedding/text-input'
import { schema2TextDocument } from '../fixtures/schema2-stored-evidence'

function createTopicEmbedding() {
  return embedding({
    kind: 'dense',
    name: 'topic-dense',
    dimensions: 2,
    maxInputTokens: 100,
    batch: { maxSize: 8 },
    embed: async (inputs) =>
      inputs.map((input) => (textOf(input).toLowerCase().includes('pricing') ? [1, 0] : [0, 1])),
  })
}

function deriveStage(id: string): DeriveStage {
  return Object.freeze({
    _tag: 'RelationStage' as const,
    kind: 'relation' as const,
    id,
    version: 1,
    fingerprint: () => `fingerprint:${id}`,
  })
}

describe('knowledge base surface', () => {
  it('rejects ambiguous pipeline and chunking configuration', () => {
    const pipeline = indexingPipeline({ chunker: chunker.text({ maxChars: 12 }) })

    expect(() =>
      knowledgeBase({
        id: 'docs',
        storage: inMemoryStorage(),
        pipeline,
        chunking: { maxChars: 12 },
      }),
    ).toThrow(/pipeline.*chunking|chunking.*pipeline/)
  })

  it('indexes and retrieves with pipeline chunking equivalently to the chunking shorthand', async () => {
    const embeddings = createTopicEmbedding()
    const input = [
      schema2TextDocument({
        namespace: 'docs',
        sourceId: 'guide',
        content: 'Pricing plans.\n\nPricing billing.',
      }),
    ]
    const shorthand = knowledgeBase({
      id: 'docs',
      storage: inMemoryStorage(),
      embeddings,
      chunking: { maxChars: 20, overlapChars: 0 },
    })
    const piped = knowledgeBase({
      id: 'docs',
      storage: inMemoryStorage(),
      embeddings,
      pipeline: indexingPipeline({ chunker: chunker.text({ maxChars: 20, overlapChars: 0 }) }),
    })

    await expect(shorthand.index(input)).resolves.toMatchObject({ chunkCount: 2 })
    await expect(piped.index(input)).resolves.toMatchObject({ chunkCount: 2 })

    const shorthandHits = await shorthand.retriever().retrieve('pricing', { limit: 5, threshold: 0.5 })
    const pipedHits = await piped.retriever().retrieve('pricing', { limit: 5, threshold: 0.5 })

    expect(pipedHits.map((hit) => hit.content)).toEqual(shorthandHits.map((hit) => hit.content))
  })

  it('fingerprints non-empty derive stages by ordered stage identity', () => {
    const first = deriveStage('first')
    const second = deriveStage('second')

    expect(indexingPipeline({ derive: [] }).fingerprint()).toBe(indexingPipeline().fingerprint())
    expect(indexingPipeline({ derive: [first] }).fingerprint()).not.toBe(indexingPipeline().fingerprint())
    expect(indexingPipeline({ derive: [first, second] }).fingerprint()).not.toBe(
      indexingPipeline({ derive: [second, first] }).fingerprint(),
    )
    expect(Object.isFrozen(indexingPipeline({ derive: [first] }).derive)).toBe(true)
  })
})
