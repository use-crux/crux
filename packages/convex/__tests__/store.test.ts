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

  it('passes list prefix and pagination to the component page contract', async () => {
    const { store, ctx } = createStore()

    ctx.runQuery.mockResolvedValue({
      docs: [
        {
          key: 'memory:1',
          content: JSON.stringify({ kind: 'note', text: 'Alpha' }),
          metadata: { _cruxDoc: true },
          updatedAt: 1,
        },
        {
          key: 'memory:2',
          content: JSON.stringify({ kind: 'draft', text: 'Beta' }),
          metadata: { _cruxDoc: true },
          updatedAt: 2,
        },
      ],
      cursor: 'cursor-2',
    })

    const result = await store.list('memory:', {
      limit: 1,
      cursor: 'cursor-1',
      filter: { kind: 'note' },
    })

    expect(ctx.runQuery).toHaveBeenCalledWith('memory:list', {
      prefix: 'memory:',
      limit: 1,
      cursor: 'cursor-1',
    })
    expect(result.entries).toEqual([{ key: 'memory:1', value: { kind: 'note', text: 'Alpha' } }])
    expect(result.cursor).toBe('cursor-2')
  })

  it('fills filtered lists from later component pages without forwarding decoded filters', async () => {
    const { store, ctx } = createStore()

    ctx.runQuery
      .mockResolvedValueOnce({
        docs: [
          cruxDoc('memory:draft', { kind: 'draft', text: 'Skip me' }),
          cruxDoc('memory:note-1', { kind: 'note', text: 'Alpha' }),
        ],
        cursor: 'cursor-1',
      })
      .mockResolvedValueOnce({
        docs: [cruxDoc('memory:note-2', { kind: 'note', text: 'Beta' })],
        cursor: 'cursor-2',
      })

    const result = await store.list('memory:', {
      limit: 2,
      filter: { kind: 'note' },
    })

    expect(result).toEqual({
      entries: [
        { key: 'memory:note-1', value: { kind: 'note', text: 'Alpha' } },
        { key: 'memory:note-2', value: { kind: 'note', text: 'Beta' } },
      ],
      cursor: 'cursor-2',
    })
    expect(ctx.runQuery).toHaveBeenNthCalledWith(1, 'memory:list', {
      prefix: 'memory:',
      limit: 2,
    })
    expect(ctx.runQuery).toHaveBeenNthCalledWith(2, 'memory:list', {
      prefix: 'memory:',
      limit: 1,
      cursor: 'cursor-1',
    })
  })
})

function cruxDoc(key: string, value: Record<string, unknown>): Record<string, unknown> {
  return {
    key,
    content: JSON.stringify(value),
    metadata: { _cruxDoc: true },
    updatedAt: 1,
  }
}
