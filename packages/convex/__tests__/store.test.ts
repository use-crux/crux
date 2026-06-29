import { describe, expect, it, vi } from 'vitest'
import { describeCruxStoreConformance } from '@use-crux/core/store/testing/vitest'
import { cruxConvexStore, type ConvexContext } from '../store'
import type { StoreDocRecord } from '../store-doc'
import type { ComponentApi } from '../src/component/_generated/component'

describe('cruxConvexStore', () => {
  function createStore(config: { vectorIndexName?: string } = {}) {
    const component = {
      memory: {
        get: 'memory:get',
        set: 'memory:set',
        insert: 'memory:insert',
        remove: 'memory:remove',
        list: 'memory:list',
      },
    }
    const docs = new Map<string, StoreDocRecord>()

    const ctx = {
      runQuery: vi.fn(async (ref: unknown, args: Record<string, unknown>) => {
        if (ref === 'memory:get') {
          return typeof args.key === 'string' ? (docs.get(args.key) ?? null) : null
        }
        if (ref === 'memory:list') {
          const prefix = typeof args.prefix === 'string' ? args.prefix : ''
          const cursor = typeof args.cursor === 'string' ? args.cursor : undefined
          const limit = typeof args.limit === 'number' ? args.limit : Number.POSITIVE_INFINITY
          const matching = [...docs.values()]
            .filter((doc) => typeof doc.key === 'string' && doc.key.startsWith(prefix))
            .sort((a, b) => String(a.key).localeCompare(String(b.key)))
          const start = cursor ? matching.findIndex((doc) => doc.key === cursor) + 1 : 0
          const page = matching.slice(start, start + limit)
          const hasMore = start + limit < matching.length
          return { docs: page, cursor: hasMore ? String(page.at(-1)?.key) : undefined }
        }
        return null
      }),
      runMutation: vi.fn(async (ref: unknown, args: Record<string, unknown>) => {
        if (ref === 'memory:set') {
          const key = String(args.key)
          const existing = docs.get(key)
          docs.set(key, {
            ...args,
            key,
            createdAt: existing?.createdAt ?? args.updatedAt,
          })
        }
        if (ref === 'memory:remove' && typeof args.key === 'string') {
          docs.delete(args.key)
        }
        return null
      }),
      vectorSearch: vi.fn(async (_table: string, _index: string, opts: { vector: readonly number[]; limit?: number }) =>
        searchStoredVectors(docs, opts.vector, opts.limit ?? 10),
      ),
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

  describeCruxStoreConformance({
    name: 'cruxConvexStore',
    prepare: () => createStore().store,
    supports: {
      ttl: true,
      vectorSearch: true,
    },
  })

  it('wires dense vector search through the configured Convex vector index', async () => {
    const { store, ctx } = createStore({
      vectorIndexName: 'by_custom_embedding',
    })

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

  it('passes list prefix and pagination to the component page contract without decoded filters', async () => {
    const { store, ctx } = createStore()

    ctx.runQuery.mockResolvedValue({
      docs: [],
      cursor: 'cursor-2',
    })

    const result = await store.list('memory:', {
      cursor: 'cursor-1',
      filter: { kind: 'note' },
    })

    expect(ctx.runQuery).toHaveBeenCalledWith('memory:list', {
      prefix: 'memory:',
      cursor: 'cursor-1',
    })
    expect(result.entries).toEqual([])
    expect(result.cursor).toBe('cursor-2')
  })
})

function searchStoredVectors(
  docs: Map<string, StoreDocRecord>,
  queryVector: readonly number[],
  limit: number,
): StoreDocRecord[] {
  return [...docs.values()]
    .filter((doc) => Array.isArray(doc.embedding))
    .map((doc) => ({
      ...doc,
      _score: cosineSimilarity([...queryVector], (doc.embedding as number[] | undefined) ?? []),
    }))
    .sort((a, b) => Number(b._score ?? 0) - Number(a._score ?? 0))
    .slice(0, limit)
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index]
    normA += a[index] * a[index]
    normB += b[index] * b[index]
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB)
  return denominator === 0 ? 0 : dot / denominator
}
