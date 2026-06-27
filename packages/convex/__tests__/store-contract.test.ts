import { describe, expect, it, vi } from 'vitest'
import { defineConvexStoreContract, type ConvexCruxStoreComponent, type ConvexCtxPort } from '../index'

describe('defineConvexStoreContract', () => {
  it('creates a server store and transport from the same component contract', async () => {
    const component = createComponent()
    const ctx = {
      runQuery: vi.fn(),
      runMutation: vi.fn(),
      vectorSearch: vi.fn(),
    }
    const useQuery = vi.fn((query: unknown, args: unknown) => {
      if (args === 'skip') return undefined
      if (query === component.memory.get) return cruxDoc('memory:alpha', { content: 'Alpha' })
      if (query === component.memory.list) return { docs: [cruxDoc('memory:alpha', { content: 'Alpha' })] }
      return undefined
    })

    const docs = defineConvexStoreContract({
      component,
      vectorIndexName: 'by_custom_embedding',
      now: () => 1_000,
      semanticCache: { isolatedVectorNamespace: true },
    })

    const store = docs.store(ctx as unknown as ConvexCtxPort)
    await store.set('memory:alpha', { content: 'Alpha', embedding: [0.1, 0.2] }, { ttl: 250 })

    expect(ctx.runMutation).toHaveBeenCalledWith(component.memory.set, {
      key: 'memory:alpha',
      content: JSON.stringify({ content: 'Alpha', embedding: [0.1, 0.2], _expiresAt: 1_250 }),
      metadata: { _cruxDoc: true },
      embedding: [0.1, 0.2],
      updatedAt: 1_000,
    })
    expect(store.capabilities?.()).toEqual({
      ttl: true,
      vectorSearch: { dense: true, sparse: false, hybrid: false },
      semanticCache: { isolatedVectorNamespace: true },
    })

    const transport = docs.transport({ useQuery })

    expect(transport.useDocument('memory:alpha')).toEqual({ content: 'Alpha' })
    expect(useQuery).toHaveBeenCalledWith(component.memory.get, { key: 'memory:alpha' })
    expect(transport.useDocumentList('memory:')).toEqual([
      { key: 'memory:alpha', value: { content: 'Alpha' } },
    ])
    expect(useQuery).toHaveBeenCalledWith(component.memory.list, { prefix: 'memory:' })
  })
})

function createComponent(): ConvexCruxStoreComponent {
  return {
    memory: {
      get: Symbol('memory.get'),
      list: Symbol('memory.list'),
      set: Symbol('memory.set'),
      remove: Symbol('memory.remove'),
    },
  }
}

function cruxDoc(key: string, value: Record<string, unknown>): Record<string, unknown> {
  return {
    key,
    content: JSON.stringify(value),
    metadata: { _cruxDoc: true },
    updatedAt: 1,
  }
}
