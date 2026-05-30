import { afterEach, describe, expect, it } from 'vitest'
import { corpus, indexer, indexingPipeline, transform } from '../../indexing'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '../../observability'
import { retrievalPipeline, retrievalStage, retriever } from '../../retrieval'
import { inMemoryCruxStore } from '../../store/memory'
import type { RetrieverHit } from '../../retrieval'

function hit(id: string, content: string, score = 1): RetrieverHit {
  return {
    namespace: 'kb',
    sourceId: id.split('/')[0] ?? id,
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
      retrieve: async () => [hit('refund/a', 'Refunds are issued within 14 days.', 0.92)],
    })

    await docs.retrieve('refund policy', { limit: 1 })
    await observe.flush()

    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:start',
        primitive: 'retrieval.query',
        name: 'docs.retrieve',
        attributes: expect.objectContaining({ retrieverId: 'docs', namespace: 'kb', query: 'refund policy' }),
      }),
    )
    expect(transport.records).toContainEqual(expect.objectContaining({ type: 'artifact', kind: 'retrieval.hits' }))
    expect(transport.records).toContainEqual(expect.objectContaining({ type: 'edge', edgeType: 'retrieval.returned' }))
  })

  it('records retrieval pipelines and every stage as canonical child spans', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const base = retriever({
      id: 'docs',
      namespace: 'kb',
      retrieve: async () => [hit('refund/a', 'Refund overview', 0.8), hit('billing/b', 'Billing policy', 0.7)],
    })
    const pipeline = retrievalPipeline(base, [
      retrievalStage({
        name: 'top-one',
        phase: 'hits',
        run: ({ hits }) => hits.slice(0, 1),
      }),
    ])

    await pipeline.retrieveWithTrace('refund')
    await observe.flush()

    const starts = transport.records.filter((record) => record.type === 'span:start')
    expect(starts).toContainEqual(
      expect.objectContaining({ primitive: 'retrieval.query', name: 'docs.pipeline', parentSpanId: null }),
    )
    expect(starts).toContainEqual(
      expect.objectContaining({
        primitive: 'retrieval.stage',
        name: 'hits:fanout',
        attributes: expect.objectContaining({ stageName: 'fanout', phase: 'hits' }),
      }),
    )
    expect(starts).toContainEqual(
      expect.objectContaining({
        primitive: 'retrieval.stage',
        name: 'hits:top-one',
        attributes: expect.objectContaining({ stageName: 'top-one', phase: 'hits' }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'output',
        attributes: expect.objectContaining({ primitive: 'retrieval.stage', stageName: 'top-one' }),
      }),
    )
  })

  it('records indexing operations and pipeline stages as inspectable spans and artifacts', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const store = inMemoryCruxStore()
    const docs = indexer({
      id: 'docs',
      namespace: 'kb',
      store,
      pipeline: indexingPipeline({
        documents: [
          transform.document({
            name: 'trim',
            version: '1',
            run: (document) => ({ ...document, content: document.content.trim() }),
          }),
        ],
      }),
    })

    await docs.indexDocuments([{ namespace: 'kb', sourceId: 'intro', content: '  Hello indexing  ' }], { dryRun: true })
    await observe.flush()

    const starts = transport.records.filter((record) => record.type === 'span:start')
    expect(starts).toContainEqual(
      expect.objectContaining({
        primitive: 'indexing.pipeline',
        name: 'docs.indexDocuments',
        attributes: expect.objectContaining({ indexerId: 'docs', operation: 'indexDocuments', dryRun: true }),
      }),
    )
    expect(starts).toContainEqual(
      expect.objectContaining({
        primitive: 'indexing.pipeline',
        name: 'document-transform:trim',
        attributes: expect.objectContaining({ stageKind: 'document-transform', stageName: 'trim' }),
      }),
    )
    expect(starts).toContainEqual(
      expect.objectContaining({
        primitive: 'indexing.pipeline',
        name: 'chunker:structured',
        attributes: expect.objectContaining({ stageKind: 'chunker', stageName: 'structured' }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'output',
        attributes: expect.objectContaining({ primitive: 'indexing.pipeline', operation: 'indexDocuments' }),
      }),
    )
  })

  it('records corpus sync, ingest load results, and nested indexing work in one trace', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const store = inMemoryCruxStore()
    const docsIndexer = indexer({ id: 'docs', namespace: 'kb', store })
    const docs = corpus({ id: 'docs', namespace: 'kb', store, indexer: docsIndexer })

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

    const starts = transport.records.filter((record) => record.type === 'span:start')
    const corpusSpan = starts.find((record) => record.primitive === 'corpus.sync')
    expect(corpusSpan).toMatchObject({
      name: 'docs.sync',
      attributes: expect.objectContaining({ corpusId: 'docs', sourceCount: 1 }),
    })
    expect(starts).toContainEqual(
      expect.objectContaining({
        primitive: 'ingest.parse',
        name: 'docs.ingest:intro',
        parentSpanId: corpusSpan?.spanId,
        attributes: expect.objectContaining({ sourceId: 'intro', warningCount: 1 }),
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
        kind: 'output',
        attributes: expect.objectContaining({ primitive: 'corpus.sync', corpusId: 'docs', sourceCount: 1 }),
      }),
    )
  })
})
