import { describe, expect, it, vi } from 'vitest'
import { cruxConvexStore } from '../index'

describe('cruxConvexStore', () => {
  function createStore() {
    const component = {
      memory: {
        get: 'memory:get',
        set: 'memory:set',
        remove: 'memory:remove',
        list: 'memory:list',
      },
    }

    const ctx = {
      runQuery: vi.fn(),
      runMutation: vi.fn(),
      vectorSearch: vi.fn(),
    }

    return {
      store: cruxConvexStore({ component: component as any, ctx: ctx as any }),
      ctx,
    }
  }

  it('searchVectors() decodes stored Crux documents and applies top-level filters', async () => {
    const { store, ctx } = createStore()

    ctx.vectorSearch.mockResolvedValue([
      {
        _id: 'doc-1',
        _score: 0.92,
        key: 'retriever:docs:1',
        content: JSON.stringify({
          namespace: 'kb',
          sourceId: 'doc-a',
          chunkId: '0',
          content: 'Alpha',
          metadata: { topic: 'billing' },
        }),
        metadata: { _cruxDoc: true },
        createdAt: 1,
        updatedAt: 2,
      },
      {
        _id: 'doc-2',
        _score: 0.81,
        key: 'retriever:docs:2',
        content: JSON.stringify({
          namespace: 'other',
          sourceId: 'doc-b',
          chunkId: '1',
          content: 'Beta',
          metadata: { topic: 'support' },
        }),
        metadata: { _cruxDoc: true },
        createdAt: 1,
        updatedAt: 2,
      },
    ])

    const results = await store.searchVectors!({
      dense: [0.1, 0.2, 0.3],
      filter: { namespace: 'kb' },
    })

    expect(ctx.vectorSearch).toHaveBeenCalledWith('memories', 'by_embedding', {
      vector: [0.1, 0.2, 0.3],
      limit: 10,
    })
    expect(results).toEqual([
      {
        key: 'retriever:docs:1',
        value: {
          namespace: 'kb',
          sourceId: 'doc-a',
          chunkId: '0',
          content: 'Alpha',
          metadata: { topic: 'billing' },
        },
        score: 0.92,
      },
    ])
  })

  it('throws explicit errors for sparse and hybrid queries', async () => {
    const { store } = createStore()

    await expect(
      store.searchVectors!({
        sparse: { indices: [1], values: [0.5] },
      }),
    ).rejects.toThrow(/does not support sparse retrieval/i)

    await expect(
      store.searchVectors!({
        dense: [0.1],
        sparse: { indices: [1], values: [0.5] },
      }),
    ).rejects.toThrow(/does not support hybrid/i)
  })
})
