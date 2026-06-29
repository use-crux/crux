import { describe, it, expect, vi, afterEach } from 'vitest'
import { z } from 'zod'
import { getRuntime, updateRuntime, resetRuntime } from '../runtime/runtime'
import type { InstrumentationHooks } from '../runtime/middleware'
import { episodes, facts, workingState } from '../memory'
import { blackboard as makeBlackboard } from '../agent/blackboard'
import { handoff as makeHandoff } from '../agent/handoff'
import { createBudgetManager } from '../compaction/budget'
import { createSlidingWindow } from '../compaction/sliding-window'
import { llmJudge } from '../scoring/judge'
import { embedding as makeEmbedding } from '../embedding'
import { corpus as makeCorpus, indexer as makeIndexer } from '../indexing'
import { retriever as makeRetriever } from '../retrieval'
import { inMemoryCruxStore } from '../store/memory'
import type { GenerateTextFn } from '../compaction/types'
import type { GenerateObjectFn } from '../compaction/types'

function mockHooks(): InstrumentationHooks & Record<string, ReturnType<typeof vi.fn>> {
  return {
    onEmbedStart: vi.fn(),
    onEmbedEnd: vi.fn(),
    onRetrievalStart: vi.fn(),
    onRetrievalEnd: vi.fn(),
    onIndexStart: vi.fn(),
    onIndexEnd: vi.fn(),
    onCorpusSyncStart: vi.fn(),
    onCorpusSource: vi.fn(),
    onCorpusSyncEnd: vi.fn(),
    onMemoryRead: vi.fn(),
    onMemoryWrite: vi.fn(),
    onCompactStart: vi.fn(),
    onCompactEnd: vi.fn(),
    onBudgetCheck: vi.fn(),
    onBlackboardUpdate: vi.fn(),
    onHandoffPrepare: vi.fn(),
    onJudgeResult: vi.fn(),
    onDelegateStart: vi.fn(),
    onDelegateComplete: vi.fn(),
    onToolStart: vi.fn(),
    onToolEnd: vi.fn(),
    onSecurityWarning: vi.fn(),
  }
}

describe('InstrumentationHooks', () => {
  afterEach(() => {
    resetRuntime()
  })

  it('set and get hooks', () => {
    expect(getRuntime().instrumentationHooks).toBeUndefined()
    const hooks = mockHooks()
    updateRuntime({ instrumentationHooks: hooks })
    expect(getRuntime().instrumentationHooks).toBe(hooks)
  })

  it('clearing hooks returns undefined', () => {
    updateRuntime({ instrumentationHooks: mockHooks() })
    resetRuntime()
    expect(getRuntime().instrumentationHooks).toBeUndefined()
  })

  describe('Memory blocks', () => {
    it('workingState get emits onMemoryRead', async () => {
      const hooks = mockHooks()
      updateRuntime({ instrumentationHooks: hooks })
      const store = inMemoryCruxStore()
      const mem = workingState({
        id: 'state',
        schema: z.object({ x: z.string() }),
      })

      await mem.get({ store, namespace: 'test', memoryId: 'test' })
      expect(hooks.onMemoryRead).toHaveBeenCalledWith(
        expect.objectContaining({
          memoryId: 'test',
          operation: 'get',
          resultCount: 0,
          memoryType: 'block',
          blockKind: 'working',
        }),
      )
    })

    it('workingState set emits onMemoryWrite', async () => {
      const hooks = mockHooks()
      updateRuntime({ instrumentationHooks: hooks })
      const store = inMemoryCruxStore()
      const mem = workingState({
        id: 'state',
        schema: z.object({ x: z.string() }),
      })

      await mem.set({ x: 'hello' }, { store, namespace: 'test', memoryId: 'test' })
      expect(hooks.onMemoryWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          memoryId: 'test',
          operation: 'set',
          memoryType: 'block',
          blockKind: 'working',
        }),
      )
    })

    it('episodes record and recall emit memory hooks', async () => {
      const hooks = mockHooks()
      updateRuntime({ instrumentationHooks: hooks })
      const store = inMemoryCruxStore()
      const mem = episodes({ id: 'episodes' })

      const key = await mem.record({ content: 'event' }, { store, namespace: 'test', memoryId: 'test' })
      expect(hooks.onMemoryWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          memoryId: 'test',
          operation: 'record',
          entryKey: key,
          memoryType: 'block',
          blockKind: 'episodes',
        }),
      )

      hooks.onMemoryRead.mockClear()

      await mem.recall('event', { store, namespace: 'test', memoryId: 'test' })
      expect(hooks.onMemoryRead).toHaveBeenCalledWith(
        expect.objectContaining({
          memoryId: 'test',
          operation: 'list',
          memoryType: 'block',
          blockKind: 'episodes',
        }),
      )
    })

    it('facts add and find emit memory hooks', async () => {
      const hooks = mockHooks()
      updateRuntime({ instrumentationHooks: hooks })
      const store = inMemoryCruxStore()
      const mem = facts({ id: 'facts', write: { mode: 'auto' } })

      const key = await mem.add({ content: 'fact' }, { store, namespace: 'test', memoryId: 'test' })
      expect(hooks.onMemoryWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          memoryId: 'test',
          operation: 'add',
          entryKey: key,
          memoryType: 'block',
          blockKind: 'facts',
        }),
      )

      hooks.onMemoryRead.mockClear()

      await mem.find('query', { store, namespace: 'test', memoryId: 'test' })
      expect(hooks.onMemoryRead).toHaveBeenCalledWith(
        expect.objectContaining({
          memoryId: 'test',
          operation: 'list',
          memoryType: 'block',
          blockKind: 'facts',
        }),
      )
    })
  })

  describe('Embeddings', () => {
    it('embedMany emits onEmbedStart and onEmbedEnd', async () => {
      const hooks = mockHooks()
      updateRuntime({ instrumentationHooks: hooks })

      const embedding = makeEmbedding({
        kind: 'dense',
        name: 'instrumented',
        dimensions: 2,
        maxInputTokens: 100,
        batch: { maxSize: 2 },
        embed: async (texts) => ({
          embeddings: texts.map((text) => [text.length, text.length]),
          usage: { inputTokens: texts.length, totalTokens: texts.length },
          cost: 0.25,
        }),
      })

      await embedding.embedMany(['a', 'bb', 'ccc'])

      expect(hooks.onEmbedStart).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'instrumented',
          kind: 'dense',
          operation: 'embedMany',
          inputCount: 3,
        }),
      )
      expect(hooks.onEmbedEnd).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'instrumented',
          usage: { inputTokens: 3, totalTokens: 3 },
          cost: 0.5,
        }),
      )
    })
  })

  describe('Retrieval', () => {
    it('retrieve emits onRetrievalStart and onRetrievalEnd', async () => {
      const hooks = mockHooks()
      updateRuntime({ instrumentationHooks: hooks })
      const store = inMemoryCruxStore()
      const dense = makeEmbedding({
        kind: 'dense',
        name: 'retrieval-dense',
        dimensions: 2,
        maxInputTokens: 100,
        batch: { maxSize: 4 },
        embed: async (texts) => ({
          embeddings: texts.map((text) => [text.length, text.length]),
        }),
      })
      const indexer = makeIndexer({
        id: 'docs',
        namespace: 'knowledge',
        store,
        dense,
      })
      await indexer.indexDocuments([
        {
          namespace: 'knowledge',
          sourceId: 'doc-1',
          content: 'Alpha retrieval fact',
        },
      ])
      hooks.onIndexStart.mockClear()
      hooks.onIndexEnd.mockClear()

      const retriever = makeRetriever({
        id: 'docs',
        namespace: 'knowledge',
        store,
        dense,
      })

      await retriever.retrieve('Alpha', { limit: 3, threshold: 0.1 })

      expect(hooks.onRetrievalStart).toHaveBeenCalledWith(
        expect.objectContaining({
          retrieverId: 'docs',
          namespace: 'knowledge',
          mode: 'dense',
          query: 'Alpha',
          limit: 3,
          threshold: 0.1,
        }),
      )
      expect(hooks.onRetrievalEnd).toHaveBeenCalledWith(
        expect.objectContaining({
          retrieverId: 'docs',
          namespace: 'knowledge',
          mode: 'dense',
          query: 'Alpha',
          resultCount: 1,
        }),
      )
    })
  })

  describe('Indexing', () => {
    it('indexDocuments emits onIndexStart and onIndexEnd', async () => {
      const hooks = mockHooks()
      updateRuntime({ instrumentationHooks: hooks })
      const store = inMemoryCruxStore()
      const dense = makeEmbedding({
        kind: 'dense',
        name: 'index-dense',
        dimensions: 2,
        maxInputTokens: 100,
        batch: { maxSize: 4 },
        embed: async (texts) => ({
          embeddings: texts.map((text) => [text.length, text.length]),
        }),
      })
      const indexer = makeIndexer({
        id: 'docs',
        namespace: 'knowledge',
        store,
        dense,
      })

      await indexer.indexDocuments([
        {
          namespace: 'knowledge',
          sourceId: 'doc-1',
          content: 'Alpha\n\nBeta',
        },
      ])

      expect(hooks.onIndexStart).toHaveBeenCalledWith(
        expect.objectContaining({
          indexerId: 'docs',
          namespace: 'knowledge',
          operation: 'indexDocuments',
          sourceCount: 1,
          chunkCount: 1,
          replaceSources: true,
        }),
      )
      expect(hooks.onIndexEnd).toHaveBeenCalledWith(
        expect.objectContaining({
          indexerId: 'docs',
          namespace: 'knowledge',
          operation: 'indexDocuments',
          sourceCount: 1,
          chunkCount: 1,
        }),
      )
    })

    it('corpus sync emits sync and source lifecycle hooks', async () => {
      const hooks = mockHooks()
      updateRuntime({ instrumentationHooks: hooks })
      const store = inMemoryCruxStore()
      const docsIndexer = makeIndexer({
        id: 'docs',
        namespace: 'knowledge',
        store,
      })
      const docs = makeCorpus({
        id: 'docs',
        namespace: 'knowledge',
        store,
        indexer: docsIndexer,
      })

      await docs.sync([
        {
          namespace: 'knowledge',
          sourceId: 'doc-1',
          content: 'Alpha',
        },
      ])

      expect(hooks.onCorpusSyncStart).toHaveBeenCalledWith(
        expect.objectContaining({
          corpusId: 'docs',
          namespace: 'knowledge',
          mode: 'replaceChanged',
          stalePolicy: 'keep',
          sourceSet: 'partial',
          dryRun: false,
          sourceCount: 1,
        }),
      )
      expect(hooks.onCorpusSource).toHaveBeenCalledWith(
        expect.objectContaining({
          corpusId: 'docs',
          namespace: 'knowledge',
          sourceId: 'doc-1',
          action: 'added',
          reason: 'new',
          dryRun: false,
          chunkCount: 1,
        }),
      )
      expect(hooks.onCorpusSyncEnd).toHaveBeenCalledWith(
        expect.objectContaining({
          corpusId: 'docs',
          namespace: 'knowledge',
          added: 1,
          failed: 0,
          chunkCount: 1,
        }),
      )
    })
  })

  describe('Blackboard', () => {
    const schema = z.object({ goal: z.string(), status: z.string() })

    it('set emits onBlackboardUpdate', async () => {
      const hooks = mockHooks()
      updateRuntime({ instrumentationHooks: hooks })
      const board = makeBlackboard({ id: 'bb', schema })

      await board.set('goal', 'test')
      expect(hooks.onBlackboardUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ boardId: 'bb', fieldsChanged: ['goal'] }),
      )
    })

    it('patch emits onBlackboardUpdate with all fields', async () => {
      const hooks = mockHooks()
      updateRuntime({ instrumentationHooks: hooks })
      const board = makeBlackboard({ id: 'bb', schema })

      await board.patch({ goal: 'g', status: 's' })
      expect(hooks.onBlackboardUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          boardId: 'bb',
          fieldsChanged: ['goal', 'status'],
        }),
      )
    })

    it('clear emits onBlackboardUpdate', async () => {
      const hooks = mockHooks()
      updateRuntime({ instrumentationHooks: hooks })
      const board = makeBlackboard({ id: 'bb', schema })

      await board.set('goal', 'test')
      hooks.onBlackboardUpdate.mockClear()

      await board.clear()
      expect(hooks.onBlackboardUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ boardId: 'bb', fieldsChanged: ['*'] }),
      )
    })
  })

  describe('Handoff', () => {
    it('prepare emits onHandoffPrepare', async () => {
      const hooks = mockHooks()
      updateRuntime({ instrumentationHooks: hooks })
      const h = makeHandoff({
        id: 'h1',
        inputSchema: z.object({ x: z.string() }),
        outputSchema: z.object({ y: z.string() }),
        transform: (input) => ({ y: input.x }),
      })

      await h.prepare({ x: 'hello' })
      expect(hooks.onHandoffPrepare).toHaveBeenCalledWith(
        expect.objectContaining({
          handoffId: 'h1',
          inputSize: expect.any(Number),
          outputSize: expect.any(Number),
        }),
      )
    })
  })

  describe('SlidingWindow', () => {
    it('emits onCompactStart and onCompactEnd when eviction occurs', async () => {
      const hooks = mockHooks()
      updateRuntime({ instrumentationHooks: hooks })

      const mockGenerate: GenerateTextFn = async () => ({
        text: 'Summary of conversation',
      })
      const sw = createSlidingWindow({
        windowSize: 2,
        generate: mockGenerate,
        model: 'mock',
      })

      await sw.push({ role: 'user', content: 'msg1' })
      await sw.push({ role: 'assistant', content: 'msg2' })
      expect(hooks.onCompactStart).not.toHaveBeenCalled()

      // Third push triggers eviction
      await sw.push({ role: 'user', content: 'msg3' })
      expect(hooks.onCompactStart).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'sliding-window',
          inputMessageCount: 1,
        }),
      )
      expect(hooks.onCompactEnd).toHaveBeenCalledWith(
        expect.objectContaining({
          durationMs: expect.any(Number),
          outputTokens: expect.any(Number),
        }),
      )
    })
  })

  describe('BudgetManager', () => {
    it('check emits onBudgetCheck', () => {
      const hooks = mockHooks()
      updateRuntime({ instrumentationHooks: hooks })
      const bm = createBudgetManager({ limit: 1000 })

      bm.report('system', 500)
      bm.check()
      expect(hooks.onBudgetCheck).toHaveBeenCalledWith(
        expect.objectContaining({ used: 500, available: 500, level: 'normal' }),
      )
    })
  })

  describe('Judge', () => {
    it('score emits onJudgeResult', async () => {
      const hooks = mockHooks()
      updateRuntime({ instrumentationHooks: hooks })

      const mockGenerate: GenerateObjectFn = async () => ({
        object: { reasoning: 'Good output', score: 4 },
      })
      const judge = llmJudge({
        id: 'test-judge',
        criteria: 'Quality',
        scale: { min: 1, max: 5 },
        generate: mockGenerate,
        model: 'mock',
      })

      await judge.score({ input: 'question', output: 'answer' })
      expect(hooks.onJudgeResult).toHaveBeenCalledWith(
        expect.objectContaining({
          metricId: 'test-judge',
          score: 4,
          reasoning: 'Good output',
        }),
      )
    })
  })

  describe('no hooks installed', () => {
    it('primitives work without errors when no hooks set', async () => {
      // Ensure no hooks
      resetRuntime()

      const store = inMemoryCruxStore()
      const mem = workingState({
        id: 'state',
        schema: z.object({ x: z.string() }),
      })
      const runtime = { store, namespace: 'safe', memoryId: 'safe' }
      await mem.set({ x: 'test' }, runtime)
      await mem.get(runtime)
      await mem.clear(runtime)
      // No errors = pass
    })
  })
})
