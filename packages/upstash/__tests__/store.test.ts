import { describe, expect, it, vi } from 'vitest'
import { cruxUpstashStore } from '../index'

function fnRef(name: string) {
  return { _type: name }
}

function createStore() {
  const namespace = {
    upsert: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(undefined),
  }
  const index = {
    namespace: vi.fn(() => namespace),
    upsert: vi.fn(),
    query: vi.fn(),
    delete: vi.fn(),
  }
  const docs = new Map<string, any>()
  const fns = {
    get: fnRef('get'),
    set: fnRef('set'),
    insert: fnRef('insert'),
    delete: fnRef('delete'),
    list: fnRef('list'),
  }
  const ctx = {
    runQuery: vi.fn(async (fn, args) => {
      if (fn === fns.get) return docs.get(args.key) ?? null
      if (fn === fns.list) return [...docs.values()].filter((doc) => doc.key.startsWith(args.prefix))
      return null
    }),
    runMutation: vi.fn(async (fn, args) => {
      if (fn === fns.set) {
        docs.set(args.key, {
          key: args.key,
          content: args.content,
          metadata: args.metadata,
          createdAt: Date.now(),
          updatedAt: args.updatedAt,
        })
      }
      if (fn === fns.insert) {
        const existing = docs.get(args.key)
        if (existing && !isExpiredStoreDoc(existing)) return false
        docs.set(args.key, {
          key: args.key,
          content: args.content,
          metadata: args.metadata,
          createdAt: Date.now(),
          updatedAt: args.updatedAt,
        })
        return true
      }
      if (fn === fns.delete) docs.delete(args.key)
    }),
  }

  return {
    store: cruxUpstashStore({
      index: index as any,
      namespace: 'semantic-cache',
      convex: { ctx, fns },
      semanticCache: { isolatedVectorNamespace: true },
    }),
    ctx,
    namespace,
    docs,
  }
}

describe('cruxUpstashStore', () => {
  it('preserves arbitrary CruxStore JSON values for semantic-cache entries', async () => {
    const { store } = createStore()
    const value = {
      cruxType: 'semantic-cache-entry',
      namespace: 'default',
      scopeHash: 'scope',
      version: 'v1',
      queryHash: 'query',
      resultKind: 'object',
      result: { object: { intent: 'billing' } },
      embedding: [1, 0, 0],
    }

    await store.set('cache:1', value, { ttl: 60_000 })
    await expect(store.get('cache:1')).resolves.toMatchObject(value)
  })

  it('setIfAbsent inserts once through the Convex insert mutation', async () => {
    const { store } = createStore()

    await expect(store.setIfAbsent('cache:1', { value: 1 })).resolves.toBe(true)
    await expect(store.setIfAbsent('cache:1', { value: 2 })).resolves.toBe(false)

    await expect(store.get('cache:1')).resolves.toMatchObject({ value: 1 })
  })

  it('setIfAbsent treats expired Convex documents as absent', async () => {
    const { store, docs } = createStore()
    docs.set('cache:expired', {
      key: 'cache:expired',
      content: JSON.stringify({ value: 'old', _expiresAt: Date.now() - 1 }),
      metadata: { _cruxDoc: true },
      createdAt: Date.now() - 10,
      updatedAt: Date.now() - 10,
    })

    await expect(store.setIfAbsent('cache:expired', { value: 'new' })).resolves.toBe(true)
    await expect(store.get('cache:expired')).resolves.toMatchObject({ value: 'new' })
  })

  it('returns decoded semantic-cache entries from vector search', async () => {
    const { store, namespace } = createStore()
    await store.set(
      'cache:1',
      {
        cruxType: 'semantic-cache-entry',
        namespace: 'default',
        scopeHash: 'scope',
        version: 'v1',
        queryHash: 'query',
        resultKind: 'text',
        result: { text: 'cached answer' },
        embedding: [1, 0, 0],
      },
      { ttl: 60_000 },
    )
    namespace.query.mockResolvedValue([{ id: 'cache:1', score: 0.99, metadata: { _key: 'cache:1' } }])

    const results = await store.searchVectors!({
      dense: [1, 0, 0],
      filter: { cruxType: 'semantic-cache-entry', scopeHash: 'scope' },
      threshold: 0.95,
    })

    expect(results).toHaveLength(1)
    expect(results[0]?.value).toMatchObject({
      cruxType: 'semantic-cache-entry',
      result: { text: 'cached answer' },
    })
  })

  it('stores index metadata needed for native filtered retrieval', async () => {
    const { store, namespace } = createStore()

    await store.set('indexer:docs:namespace:kb:source:intro:chunk:chunk_1', {
      _cruxRecordType: 'chunk',
      namespace: 'kb',
      sourceId: 'intro',
      chunkId: 'chunk_1',
      generationId: 'gen_1',
      active: true,
      content: 'Hello',
      metadata: { topic: 'launch' },
      embedding: [1, 0, 0],
    })

    expect(namespace.upsert).toHaveBeenCalledWith({
      id: 'indexer:docs:namespace:kb:source:intro:chunk:chunk_1',
      vector: [1, 0, 0],
      metadata: expect.objectContaining({
        _key: 'indexer:docs:namespace:kb:source:intro:chunk:chunk_1',
        _cruxRecordType: 'chunk',
        namespace: 'kb',
        sourceId: 'intro',
        chunkId: 'chunk_1',
        generationId: 'gen_1',
        active: true,
        topic: 'launch',
      }),
    })
  })

  it('pushes simple vector filters and fusion to Upstash queries', async () => {
    const { store, namespace } = createStore()
    await store.set('chunk:1', {
      _cruxRecordType: 'chunk',
      namespace: 'kb',
      sourceId: 'intro',
      chunkId: 'chunk_1',
      active: true,
      content: 'Hello',
      metadata: {},
      embedding: [1, 0, 0],
    })
    namespace.query.mockResolvedValue([{ id: 'chunk:1', score: 0.99, metadata: { _key: 'chunk:1' } }])

    await store.searchVectors!({
      dense: [1, 0, 0],
      sparse: { indices: [1], values: [1] },
      fusion: 'dbsf',
      filter: { namespace: 'kb', _cruxRecordType: 'chunk', active: true },
    })

    expect(namespace.query).toHaveBeenCalledWith(
      expect.objectContaining({
        vector: [1, 0, 0],
        sparseVector: { indices: [1], values: [1] },
        fusion: 'dbsf',
        filter: "namespace = 'kb' and _cruxRecordType = 'chunk' and active = true",
      }),
    )
  })

  it('advertises semantic-cache capability only when explicitly isolated', () => {
    const { store } = createStore()
    expect(store.capabilities?.().semanticCache?.isolatedVectorNamespace).toBe(true)

    const index = {
      namespace: () => ({ upsert: vi.fn(), query: vi.fn(), delete: vi.fn() }),
    }
    const ctx = { runQuery: vi.fn(), runMutation: vi.fn() }
    const fns = {
      get: fnRef('get'),
      set: fnRef('set'),
      insert: fnRef('insert'),
      delete: fnRef('delete'),
      list: fnRef('list'),
    }
    const shared = cruxUpstashStore({
      index: index as any,
      namespace: 'docs',
      convex: { ctx, fns },
    })

    expect(shared.capabilities?.().semanticCache?.isolatedVectorNamespace).toBe(false)
  })
})

function isExpiredStoreDoc(doc: { content?: unknown; metadata?: unknown }): boolean {
  const metadata = doc.metadata as Record<string, unknown> | undefined
  if (metadata?._cruxDoc !== true || typeof doc.content !== 'string') {
    return false
  }

  try {
    const value = JSON.parse(doc.content) as Record<string, unknown>
    return typeof value._expiresAt === 'number' && Date.now() >= value._expiresAt
  } catch {
    return false
  }
}
