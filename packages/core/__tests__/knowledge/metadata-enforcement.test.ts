import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { embedding } from '../../src/embedding'
import { corpus as createCorpus, indexer as createIndexer } from '../../src/indexing'
import { knowledgeBase } from '../../src/retrieval'
import { inMemoryRecordStore, inMemoryStorage, inMemorySearchStore } from '../../src/storage'
import { textOf } from '../embedding/text-input'
import type { CruxChunk } from '../../src/indexing'
import { schema2TextChunk, schema2TextDocument } from '../fixtures/schema2-stored-evidence'

function topicEmbedding() {
  return embedding({
    kind: 'dense',
    name: 'metadata-test-dense',
    dimensions: 2,
    maxInputTokens: 100,
    batch: { maxSize: 8 },
    embed: async (inputs) =>
      inputs.map((input) => (textOf(input).toLowerCase().includes('valid') ? [1, 0] : [0, 1])),
  })
}

const metadataSchema = z.object({
  topic: z.string(),
  section: z.string().optional(),
})

describe('knowledgeBase metadataSchema enforcement', () => {
  it('indexes documents with valid metadata', async () => {
    const docs = knowledgeBase({
      id: 'docs',
      storage: inMemoryStorage(),
      embeddings: topicEmbedding(),
      metadataSchema,
    })

    await expect(
      docs.index([
        schema2TextDocument({
          namespace: 'docs',
          sourceId: 'valid',
          content: 'valid guide',
          metadata: { topic: 'guides' },
        }),
      ]),
    ).resolves.toMatchObject({ sourceCount: 1, chunkCount: 1 })

    expect(docs.inspect().lifecycle).toMatchObject({ indexedSources: 1, indexedChunks: 1 })
  })

  it('fails only the source with missing required metadata', async () => {
    const docs = knowledgeBase({
      id: 'docs',
      storage: inMemoryStorage(),
      embeddings: topicEmbedding(),
      metadataSchema,
    })

    let thrown: unknown
    try {
      await docs.index([
        schema2TextDocument({
          namespace: 'docs',
          sourceId: 'valid',
          content: 'valid guide',
          metadata: { topic: 'guides' },
        }),
        schema2TextDocument({
          namespace: 'docs',
          sourceId: 'missing-topic',
          content: 'invalid guide',
          metadata: { section: 'setup' },
        }),
      ])
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(AggregateError)
    expect((thrown as Error).message).toContain('knowledgeBase("docs")')
    expect((thrown as Error).message).toContain('source "missing-topic"')
    expect((thrown as Error).message).toContain('metadata.topic')
    expect((thrown as Error).message).not.toContain('source "valid"')
    expect(docs.inspect().lifecycle).toMatchObject({ indexedSources: 1, indexedChunks: 1 })
    await expect(docs.retriever().retrieve('valid', { threshold: 0.5 })).resolves.toEqual([
      expect.objectContaining({ source: { id: 'valid' }, content: 'valid guide' }),
    ])
  })

  it('allows absent optional metadata fields', async () => {
    const docs = knowledgeBase({
      id: 'docs',
      storage: inMemoryStorage(),
      embeddings: topicEmbedding(),
      metadataSchema,
    })

    await expect(
      docs.index([
        schema2TextDocument({
          namespace: 'docs',
          sourceId: 'valid',
          content: 'valid guide',
          metadata: { topic: 'guides' },
        }),
      ]),
    ).resolves.toMatchObject({ sourceCount: 1, chunkCount: 1 })
  })

  it('keeps existing indexing behavior without metadataSchema', async () => {
    const docs = knowledgeBase({
      id: 'docs',
      storage: inMemoryStorage(),
      embeddings: topicEmbedding(),
    })

    await expect(
      docs.index([
        schema2TextDocument({
          namespace: 'docs',
          sourceId: 'missing-topic',
          content: 'valid guide',
          metadata: { section: 'setup' },
        }),
      ]),
    ).resolves.toMatchObject({ sourceCount: 1, chunkCount: 1 })
  })

  it('validates chunk-input metadata per source', async () => {
    const docs = knowledgeBase({
      id: 'docs',
      storage: inMemoryStorage(),
      embeddings: topicEmbedding(),
      metadataSchema,
    })

    const chunks: CruxChunk[] = [
      chunk('valid', 'valid guide', { topic: 'guides' }),
      chunk('missing-topic', 'invalid guide', { section: 'setup' }),
      chunk('missing-topic', 'invalid second chunk', { topic: 'ignored-on-second-chunk' }, 1),
    ]

    await expect(docs.index(chunks)).rejects.toThrow(/knowledgeBase\("docs"\).*missing-topic.*metadata\.topic/)
    expect(docs.inspect().lifecycle).toMatchObject({ indexedSources: 1, indexedChunks: 1 })
  })

  it('reports corpus-backed metadata failures as per-source outcomes', async () => {
    const records = inMemoryRecordStore()
    const search = inMemorySearchStore()
    const embeddings = topicEmbedding()
    const index = createIndexer({
      id: 'docs',
      namespace: 'docs',
      records,
      search,
      dense: embeddings,
    })
    const corpus = createCorpus({
      id: 'docs',
      namespace: 'docs',
      records,
      indexer: index,
    })
    const docs = knowledgeBase({
      id: 'docs',
      corpus,
      records,
      search,
      embeddings,
      metadataSchema,
    })

    await expect(
      docs.index([
        schema2TextDocument({
          namespace: 'docs',
          sourceId: 'valid',
          content: 'valid guide',
          metadata: { topic: 'guides' },
        }),
        schema2TextDocument({
          namespace: 'docs',
          sourceId: 'missing-topic',
          content: 'invalid guide',
          metadata: { section: 'setup' },
        }),
      ]),
    ).resolves.toMatchObject({
      added: 1,
      failed: 1,
      sources: [
        expect.objectContaining({ sourceId: 'valid', action: 'added' }),
        expect.objectContaining({
          sourceId: 'missing-topic',
          action: 'failed',
          error: expect.objectContaining({
            message: expect.stringContaining('knowledgeBase("docs") source "missing-topic"'),
          }),
        }),
      ],
    })
    expect(docs.inspect().lifecycle).toMatchObject({ indexedSources: 1, indexedChunks: 1 })
  })
})

function chunk(
  sourceId: string,
  content: string,
  metadata: Record<string, unknown>,
  ordinal = 0,
): CruxChunk {
  return schema2TextChunk({
    namespace: 'docs',
    sourceId,
    chunkId: `${sourceId}-${ordinal}`,
    ordinal,
    content,
    metadata,
  })
}
