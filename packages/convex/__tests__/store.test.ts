import { describe, expect, it, vi } from 'vitest'
import { cruxConvexStore, type ConvexContext } from '../index'
import type { ComponentApi } from '../src/component/_generated/component'

describe('cruxConvexStore', () => {
  function createStore(config: { vectorIndexName?: string } = {}) {
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
      store: cruxConvexStore({
        component: component as unknown as ComponentApi,
        ctx: ctx as unknown as ConvexContext,
        ...config,
      }),
      ctx,
    }
  }

  it('wires dense vector search through the configured Convex vector index', async () => {
    const { store, ctx } = createStore({ vectorIndexName: 'by_custom_embedding' })

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
    ])

    const results = await store.searchVectors!({
      dense: [0.1, 0.2, 0.3],
      limit: 5,
    })

    expect(ctx.vectorSearch).toHaveBeenCalledWith('memories', 'by_custom_embedding', {
      vector: [0.1, 0.2, 0.3],
      limit: 5,
    })
    expect(results).toHaveLength(1)
    expect(results[0]?.key).toBe('retriever:docs:1')
    expect(results[0]?.score).toBe(0.92)
  })
})
