import { afterEach, describe, expect, it } from 'vitest'
import { corpus, indexer, indexingPipeline, transform } from '../../src/indexing'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '../../src/observability'
import {
  retrievalRecipe,
  retrievalStep,
  retrieve,
  retriever,
} from '../../src/retrieval'
import { inMemoryRecordStore, inMemorySearchStore } from '../../src/storage'
import type { RetrieverHit } from '../../src/retrieval'

function hit(id: string, content: string, score = 1): RetrieverHit {
  return {
    namespace: 'kb',
    source: { id: id.split('/')[0] ?? id },
    chunkId: id.split('/')[1] ?? '0',
    content,
    metadata: {},
    score,
  }
}

describe('canonical retrieval, indexing, and corpus observability', () => {
  afterEach(() => {
    resetObservabilityRuntime()
  })

  it('records standalone retriever calls as retrieval.query spans with hit artifacts and relation edges', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const docs = retriever({
      id: 'docs',
      namespace: 'kb',
      retrieve: async () => [
        {
          ...hit('refund/a', 'Refunds are issued within 14 days.', 0.92),
          source: {
            id: 'refund',
            url: 'https://user:password@example.com/refund.pdf?token=secret',
            assetRef: { uri: 'asset://private-ref' },
            mediaType: 'application/pdf',
            location: { type: 'page' as const, pageNumber: 2 },
            providerId: 'provider-secret',
          } as never,
        },
      ],
    })

    const [applicationHit] = await docs.retrieve('refund policy', { limit: 1 })
    expect(applicationHit.source).toMatchObject({
      url: 'https://user:password@example.com/refund.pdf?token=secret',
      assetRef: { uri: 'asset://private-ref' },
      location: { type: 'page', pageNumber: 2 },
    })
    expect(applicationHit.source).not.toHaveProperty('providerId')
    await observe.flush()

    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:start',
        primitive: 'retrieval.query',
        name: 'docs.retrieve',
        attributes: expect.objectContaining({
          retrieverId: 'docs',
          namespace: 'kb',
          query: 'refund policy',
        }),
      }),
    )
    expect(JSON.stringify(transport.records)).not.toMatch(/password|token=secret|asset:\/\/private-ref|provider-secret/)
    expect(transport.records).toContainEqual(
      expect.objectContaining({ type: 'artifact', kind: 'retrieval.hits' }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'retrieval.hits',
        preview: expect.objectContaining({
          kind: 'retrieval.hits',
          query: 'refund policy',
          limit: 1,
          returned: 1,
          hits: expect.arrayContaining([
            expect.objectContaining({
              rank: 1,
              namespace: 'kb',
              source: expect.objectContaining({ id: 'refund' }),
              chunkId: 'a',
              score: 0.92,
              preview: 'Refunds are issued within 14 days.',
            }),
          ]),
        }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({ type: 'edge', edgeType: 'retrieval.returned' }),
    )
  })

  it('records retrieval recipes and every step as canonical child spans', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const base = retriever({
      id: 'docs',
      namespace: 'kb',
      retrieve: async () => [
        hit('refund/a', 'Refund overview', 0.8),
        hit('billing/b', 'Billing policy', 0.7),
      ],
    })
    const recipe = retrievalRecipe({
      id: 'docs-recipe',
      retriever: base,
      steps: [
        retrieve(),
        retrievalStep({
          id: 'top-one',
          phase: { in: 'hits', out: 'hits' },
          run: ({ hits }) => ({ hits: hits.slice(0, 1) }),
        }),
      ],
    })

    await recipe.retrieveWithTrace('refund')
    await observe.flush()

    const starts = transport.records.filter(
      (record) => record.type === 'span:start',
    )
    expect(starts).toContainEqual(
      expect.objectContaining({
        primitive: 'retrieval.recipe',
        name: 'docs-recipe.recipe',
        parentSpanId: null,
        attributes: expect.objectContaining({
          recipeId: 'docs-recipe',
          sourceRetrieverIds: ['docs'],
        }),
      }),
    )
    expect(starts).toContainEqual(
      expect.objectContaining({
        primitive: 'retrieval.query',
        name: 'docs.retrieve',
      }),
    )
    expect(starts).toContainEqual(
      expect.objectContaining({
        primitive: 'retrieval.step',
        name: 'queries:retrieve',
        attributes: expect.objectContaining({
          recipeId: 'docs-recipe',
          stepId: 'retrieve',
          kind: 'retrieve',
        }),
      }),
    )
    expect(starts).toContainEqual(
      expect.objectContaining({
        primitive: 'retrieval.step',
        name: 'hits:top-one',
        attributes: expect.objectContaining({
          recipeId: 'docs-recipe',
          stepId: 'top-one',
          kind: 'custom',
        }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'retrieval.hits',
        preview: expect.objectContaining({
          kind: 'retrieval.hits',
          mode: 'recipe',
          recipeId: 'docs-recipe',
          query: 'refund',
          returned: 1,
        }),
      }),
    )
  })

  it('records indexing operations and pipeline stages as inspectable spans and artifacts', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const records = inMemoryRecordStore()
    const search = inMemorySearchStore()
    const docs = indexer({
      id: 'docs',
      namespace: 'kb',
      records,
      search,
      pipeline: indexingPipeline({
        documents: [
          transform.document({
            name: 'trim',
            version: '1',
            run: (document) => ({
              ...document,
              content: document.content.trim(),
            }),
          }),
        ],
      }),
    })

    await docs.indexDocuments(
      [{ namespace: 'kb', sourceId: 'intro', content: '  Hello indexing  ' }],
      { dryRun: true },
    )
    await observe.flush()

    const starts = transport.records.filter(
      (record) => record.type === 'span:start',
    )
    expect(starts).toContainEqual(
      expect.objectContaining({
        primitive: 'indexing.pipeline',
        name: 'docs.indexDocuments',
        attributes: expect.objectContaining({
          indexerId: 'docs',
          operation: 'indexDocuments',
          dryRun: true,
        }),
      }),
    )
    expect(starts).toContainEqual(
      expect.objectContaining({
        primitive: 'indexing.pipeline',
        name: 'document-transform:trim',
        attributes: expect.objectContaining({
          stageKind: 'document-transform',
          stageName: 'trim',
        }),
      }),
    )
    expect(starts).toContainEqual(
      expect.objectContaining({
        primitive: 'indexing.pipeline',
        name: 'chunker:structured',
        attributes: expect.objectContaining({
          stageKind: 'chunker',
          stageName: 'structured',
        }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'indexing.report',
        attributes: expect.objectContaining({
          primitive: 'indexing.pipeline',
          operation: 'indexDocuments',
        }),
        preview: expect.objectContaining({
          kind: 'indexing.report',
          operation: 'indexDocuments',
          indexerId: 'docs',
          namespace: 'kb',
          totals: expect.objectContaining({
            sources: 1,
            chunks: expect.any(Number),
          }),
          stageCounts: expect.objectContaining({
            'document-transform': 1,
            chunker: 1,
          }),
        }),
      }),
    )
  })

  it('records corpus sync, ingest load results, and nested indexing work in one trace', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const records = inMemoryRecordStore()
    const search = inMemorySearchStore()
    const docsIndexer = indexer({
      id: 'docs',
      namespace: 'kb',
      records,
      search,
    })
    const docs = corpus({
      id: 'docs',
      namespace: 'kb',
      records,
      search,
      indexer: docsIndexer,
    })

    await docs.sync([
      {
        ok: true,
        document: {
          namespace: 'kb',
          sourceId: 'intro',
          content: 'Hello corpus',
          warnings: [{ code: 'minor', message: 'Minor parser warning' }],
        },
      },
    ])
    await observe.flush()

    const starts = transport.records.filter(
      (record) => record.type === 'span:start',
    )
    const corpusSpan = starts.find(
      (record) => record.primitive === 'corpus.sync',
    )
    expect(corpusSpan).toMatchObject({
      name: 'docs.sync',
      attributes: expect.objectContaining({ corpusId: 'docs', sourceCount: 1 }),
    })
    expect(starts).toContainEqual(
      expect.objectContaining({
        primitive: 'ingest.parse',
        name: 'docs.ingest:intro',
        parentSpanId: corpusSpan?.spanId,
        attributes: expect.objectContaining({
          sourceId: 'intro',
          warningCount: 1,
        }),
      }),
    )
    expect(starts).toContainEqual(
      expect.objectContaining({
        primitive: 'indexing.pipeline',
        name: 'docs.indexDocuments',
        parentSpanId: corpusSpan?.spanId,
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'ingest.report',
        preview: expect.objectContaining({
          kind: 'ingest.report',
          sourceId: 'intro',
          status: 'success',
          warningCount: 1,
        }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'corpus.report',
        attributes: expect.objectContaining({
          primitive: 'corpus.sync',
          corpusId: 'docs',
          sourceCount: 1,
        }),
        preview: expect.objectContaining({
          kind: 'corpus.report',
          corpusId: 'docs',
          namespace: 'kb',
          totals: expect.objectContaining({
            added: 1,
            chunks: expect.any(Number),
          }),
          sources: expect.arrayContaining([
            expect.objectContaining({
              id: 'intro',
              action: 'added',
              chunks: expect.any(Number),
            }),
          ]),
        }),
      }),
    )
  })
})
