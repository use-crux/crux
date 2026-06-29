import { describe, expect, it, vi, afterEach } from 'vitest'
import { z } from 'zod'
import type { GenerateObjectFn, GenerateTextFn } from '../../compaction/types'
import { indexer as makeIndexer, chunker, indexingPipeline } from '../../indexing'
import { resetRuntime, updateRuntime } from '../../runtime/runtime'
import { embedding as makeEmbedding } from '../../embedding'
import {
  compress,
  decay,
  diversify,
  multiQuery,
  parentExpand,
  queryPlanner,
  retrievalPipeline,
  retrievalStage,
  retriever as makeRetriever,
} from '../../retrieval'
import { inMemoryCruxStore } from '../../store/memory'
import type { RetrieverHit } from '../../retrieval'

function hit(id: string, content: string, score = 1, metadata: Record<string, unknown> = {}): RetrieverHit {
  return {
    namespace: 'docs',
    sourceId: id.split('/')[0] ?? id,
    chunkId: id.split('/')[1] ?? '0',
    content,
    metadata,
    score,
  }
}

function baseRetriever(results: Record<string, RetrieverHit[]>) {
  const retrieve = vi.fn(async (query: string) => results[query] ?? [])
  return {
    retriever: makeRetriever({
      id: 'docs',
      namespace: 'docs',
      retrieve,
    }),
    retrieve,
  }
}

describe('retrievalPipeline', () => {
  afterEach(() => {
    resetRuntime()
  })

    it('wraps a retriever without changing retrieve, context, or tool usage', async () => {
    const { retriever, retrieve } = baseRetriever({
      launch: [hit('doc-1/a', 'Launch checklist')],
    })

    const pipeline = retrievalPipeline(retriever, [])

    expect(pipeline._tag).toBe('RetrievalPipeline')
    expect(pipeline.id).toBe('docs')
    expect(pipeline.namespace).toBe('docs')
    expect(await pipeline.retrieve('launch')).toEqual([hit('doc-1/a', 'Launch checklist')])
    expect(retrieve).toHaveBeenCalledWith('launch', {})

    const context = pipeline.asContext({ query: 'launch', limit: 1 })
    await expect(context.systemFn({})).resolves.toContain('Launch checklist')

    const tools = pipeline.asTools()
    await expect(tools.search.execute({ query: 'launch', limit: 1 })).resolves.toContain('Launch checklist')
  })

    it('can inject both context and prefixed tools from prompt use', async () => {
    const { prompt } = await import('../../prompt/prompt')
    const { retriever } = baseRetriever({
      launch: [hit('doc-1/a', 'Launch checklist')],
    })
    const pipeline = retrievalPipeline(retriever, [], {
      inject: 'both',
      context: { query: 'launch' },
      tools: { prefix: true },
    })

    const answer = prompt({ use: [pipeline], system: 'Base.' })
    const resolved = await answer.resolve({})

    expect(resolved.system).toContain('Launch checklist')
    expect(resolved.tools?.docsSearch).toBeDefined()
  })

    it('validates stage names, duplicates, and phase order', () => {
    const { retriever } = baseRetriever({})

    expect(() =>
      retrievalStage({
        name: '  ',
        phase: 'hits',
        run: ({ hits }) => hits,
      }),
    ).toThrow('Retrieval stage name must be non-empty')

    const trim = retrievalStage({
      name: 'trim',
      phase: 'hits',
      run: ({ hits }) => hits,
    })
    const plan = retrievalStage({
      name: 'plan',
      phase: 'query',
      run: ({ queries }) => queries,
    })

    expect(() => retrievalPipeline(retriever, [trim, trim])).toThrow('Duplicate retrieval stage name')
    expect(() => retrievalPipeline(retriever, [trim, plan])).toThrow('Query retrieval stages must run before hit stages')
  })

    it('runs multi-query fanout and merges duplicate hits with RRF by hit identity', async () => {
    const generate: GenerateTextFn = vi.fn(async () => ({
      text: ['refund policy', 'returns policy', 'refund policy'].join('\n'),
    }))
    const { retriever, retrieve } = baseRetriever({
      refund: [hit('doc-1/a', 'Refund overview', 0.7), hit('doc-2/b', 'Billing details', 0.95)],
      'refund policy': [hit('doc-1/a', 'Refund overview', 0.6), hit('doc-3/c', 'Policy details', 0.8)],
      'returns policy': [hit('doc-4/d', 'Returns details', 0.9), hit('doc-1/a', 'Refund overview', 0.5)],
    })

    const pipeline = retrievalPipeline(retriever, [multiQuery({ generate, model: 'test-model', count: 3 })])
    const { hits, trace } = await pipeline.retrieveWithTrace('refund')

    expect(retrieve).toHaveBeenCalledTimes(3)
    expect(retrieve.mock.calls.map(([query]) => query)).toEqual(['refund', 'refund policy', 'returns policy'])
    expect(hits[0]).toMatchObject({
      sourceId: 'doc-1',
      chunkId: 'a',
      metadata: {
        _cruxRetrieval: {
          matchedQueries: ['refund', 'refund policy', 'returns policy'],
          ranks: [1, 1, 2],
          rawScores: [0.7, 0.6, 0.5],
        },
      },
    })
    expect(trace.stages.map((stage) => stage.name)).toEqual(['multi-query', 'fanout'])
  })

    it('runs a typed query planner and merges planned filters into retrieval options', async () => {
    const generate: GenerateObjectFn = vi.fn(async () => ({
      object: {
        queries: [
          {
            query: 'enterprise sso setup',
            filter: { product: 'enterprise', visibility: 'public' },
            weight: 2,
            reason: 'Route to enterprise docs',
          },
        ],
      },
    }))
    const { retriever, retrieve } = baseRetriever({
      'enterprise sso setup': [hit('doc-1/a', 'SSO setup')],
    })

    const pipeline = retrievalPipeline(retriever, [
      queryPlanner({
        generate,
        model: 'planner-model',
        filterSchema: z.object({
          product: z.string().optional(),
          visibility: z.enum(['public', 'internal']).optional(),
        }),
      }),
    ])

    await expect(pipeline.retrieve('how do I configure SSO?', { filter: { locale: 'en' } })).resolves.toHaveLength(1)
    expect(retrieve).toHaveBeenCalledWith('enterprise sso setup', {
      filter: { locale: 'en', product: 'enterprise', visibility: 'public' },
    })
  })

    it('rejects invalid query planner output with a clear error', async () => {
    const generate: GenerateObjectFn = vi.fn(async () => ({ object: { queries: [{ query: '   ' }] } }))
    const { retriever } = baseRetriever({})
    const pipeline = retrievalPipeline(retriever, [queryPlanner({ generate, model: 'planner-model' })])

    await expect(pipeline.retrieve('question')).rejects.toThrow('queryPlanner returned invalid planned queries')
  })

    it('expands parent records without replacing child evidence', async () => {
    const store = inMemoryCruxStore()
    const dense = makeEmbedding({
      kind: 'dense',
      name: 'dense',
      dimensions: 2,
      maxInputTokens: 100,
      batch: { maxSize: 8 },
      embed: async (texts) => texts.map((text) => (text.includes('pricing') ? [1, 0] : [0, 1])),
    })
    const docsIndexer = makeIndexer({
      id: 'docs',
      namespace: 'docs',
      store,
      dense,
      pipeline: indexingPipeline({
        chunker: chunker.parentChild({ parentMaxChars: 80, childMaxChars: 40 }),
      }),
    })

    await docsIndexer.indexDocuments([
      {
        namespace: 'docs',
        sourceId: 'pricing',
        title: 'Pricing Guide',
        content: 'pricing overview for enterprise customers with setup and discount rules',
      },
    ])

    const docs = makeRetriever({ id: 'docs', namespace: 'docs', store, dense })
    const pipeline = retrievalPipeline(docs, [parentExpand({ store })])
    const hits = await pipeline.retrieve('pricing')

    expect(hits[0].sourceId).toBe('pricing')
    expect(hits[0].parent).toMatchObject({
      title: 'Pricing Guide',
      content: expect.stringContaining('pricing overview'),
      metadata: {},
    })
    expect(hits[0].content).not.toBe(hits[0].parent?.content)
  })

    it('can fail parent expansion when a referenced parent is missing', async () => {
    const store = inMemoryCruxStore()
    const { retriever } = baseRetriever({
      pricing: [
        {
          ...hit('pricing/a', 'child'),
          parent: { parentId: 'missing-parent', key: 'missing-key' },
        },
      ],
    })
    const pipeline = retrievalPipeline(retriever, [parentExpand({ store, missing: 'error' })])

    await expect(pipeline.retrieve('pricing')).rejects.toThrow('parentExpand could not find parent record')
  })

    it('compresses hits extractively and preserves source identity', async () => {
    const generate: GenerateObjectFn = vi.fn(async () => ({
      object: {
        hits: [
          { sourceId: 'doc-1', chunkId: 'a', excerpts: ['Relevant setup sentence.'] },
          { sourceId: 'doc-2', chunkId: 'b', excerpts: [] },
        ],
      },
    }))
    const { retriever } = baseRetriever({
      setup: [
        hit('doc-1/a', 'Relevant setup sentence. Extra irrelevant detail.', 0.9),
        hit('doc-2/b', 'No useful content', 0.5),
      ],
    })

    const pipeline = retrievalPipeline(retriever, [compress({ generate, model: 'compressor', maxCharsPerHit: 1200 })])
    const hits = await pipeline.retrieve('setup')

    expect(hits).toEqual([
      expect.objectContaining({
        sourceId: 'doc-1',
        chunkId: 'a',
        content: 'Relevant setup sentence.',
        score: 0.9,
        metadata: expect.objectContaining({
          _cruxCompression: {
            originalLength: 'Relevant setup sentence. Extra irrelevant detail.'.length,
            compressedLength: 'Relevant setup sentence.'.length,
          },
        }),
      }),
    ])
  })

    it('diversifies repeated sources and applies recency decay', async () => {
    const now = Date.now()
    const { retriever } = baseRetriever({
      roadmap: [
        hit('a/1', 'roadmap launch checklist', 1, { updatedAt: now }),
        hit('a/2', 'roadmap launch checklist duplicate', 0.99, { updatedAt: now }),
        hit('b/1', 'pricing roadmap detail', 0.8, { updatedAt: now - 1000 * 60 * 60 * 24 * 60 }),
      ],
    })

    const pipeline = retrievalPipeline(retriever, [
      diversify({ strategy: 'mmr', limit: 2, sourcePenalty: 0.4 }),
      decay({ field: 'metadata.updatedAt', halfLifeMs: 1000 * 60 * 60 * 24 * 30 }),
    ])
    const hits = await pipeline.retrieve('roadmap')

    expect(hits.map((item) => item.sourceId)).toEqual(['a', 'b'])
    expect(hits[1].score).toBeLessThan(0.8)
    expect(hits[1].metadata._cruxDecay).toMatchObject({ field: 'metadata.updatedAt' })
  })})
