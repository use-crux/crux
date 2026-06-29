import { describe, expect, it } from 'vitest'
import {
  createInMemoryConvexStoreDocumentComponent,
  defineConvexStoreContract,
  type StoreDocDenseSearchQuery,
  type StoreDocRecord,
} from '../index'
import { STORE_DOC_COMPONENT_SPEC } from '../store-doc'

describe('defineConvexStoreContract document boundary', () => {
  it('uses one in-memory component for server writes and React reads', async () => {
    const component = createInMemoryConvexStoreDocumentComponent()
    const docs = defineConvexStoreContract({
      component,
      now: () => 1_000,
      semanticCache: { isolatedVectorNamespace: true },
    })
    const store = docs.store(component.ctx)
    const transport = docs.transport({ useQuery: component.useQuery })

    await store.set('memory:alpha', { content: 'Alpha', namespace: 'kb' }, { ttl: 500 })

    await expect(store.get('memory:alpha')).resolves.toEqual({
      content: 'Alpha',
      namespace: 'kb',
      [STORE_DOC_COMPONENT_SPEC.fields.expiresAt]: 1_500,
    })
    expect(transport.useDocument('memory:alpha')).toEqual({
      content: 'Alpha',
      namespace: 'kb',
      [STORE_DOC_COMPONENT_SPEC.fields.expiresAt]: 1_500,
    })
    expect(transport.useDocumentList('memory:', { filter: { namespace: 'kb' } })).toEqual([
      {
        key: 'memory:alpha',
        value: { content: 'Alpha', namespace: 'kb', [STORE_DOC_COMPONENT_SPEC.fields.expiresAt]: 1_500 },
      },
    ])
    expect(store.capabilities?.()).toEqual({
      ttl: true,
      vectorSearch: { dense: true, sparse: false, hybrid: false },
      semanticCache: { isolatedVectorNamespace: true },
    })

    await store.delete('memory:alpha')

    await expect(store.get('memory:alpha')).resolves.toBeNull()
    expect(transport.useDocument('memory:alpha')).toBeNull()
  })

  it('applies TTL suppression, pagination fill, and dense vector result shaping through the component', async () => {
    let now = 1_000
    const component = createInMemoryConvexStoreDocumentComponent({
      denseSearch: denseSearchByScore,
    })
    const docs = defineConvexStoreContract({ component, now: () => now })
    const store = docs.store(component.ctx)
    const transport = docs.transport({ useQuery: component.useQuery })

    await store.set('memory:expired', { content: 'Old', namespace: 'kb' }, { ttl: 1 })
    await store.set('memory:fresh-a', {
      content: 'Alpha',
      namespace: 'kb',
      embedding: [1, 0],
    })
    await store.set('memory:fresh-b', {
      content: 'Beta',
      namespace: 'other',
      embedding: [0.5, 0.5],
    })
    now = 2_000

    expect(transport.useDocument('memory:expired')).toBeNull()
    await expect(store.get('memory:expired')).resolves.toBeNull()
    await expect(store.list('memory:', { limit: 1, filter: { namespace: 'kb' } })).resolves.toEqual({
      entries: [
        {
          key: 'memory:fresh-a',
          value: { content: 'Alpha', namespace: 'kb', embedding: [1, 0] },
        },
      ],
      cursor: 'memory:fresh-a',
    })
    await expect(
      store.searchVectors!({
        dense: [1, 0],
        limit: 2,
        threshold: 0.7,
        filter: { namespace: 'kb' },
      }),
    ).resolves.toEqual([
      {
        key: 'memory:fresh-a',
        value: { content: 'Alpha', namespace: 'kb', embedding: [1, 0] },
        score: 1,
      },
    ])
  })
})

function denseSearchByScore(
  query: StoreDocDenseSearchQuery,
  docs: readonly StoreDocRecord[],
): readonly StoreDocRecord[] {
  return docs
    .map((doc) => ({ ...doc, _score: dot(query.vector, vectorFromDoc(doc)) }))
    .sort((left, right) => Number(right._score) - Number(left._score))
    .slice(0, query.limit)
}

function vectorFromDoc(doc: StoreDocRecord): readonly number[] {
  return Array.isArray(doc.embedding) && doc.embedding.every((item) => typeof item === 'number') ? doc.embedding : []
}

function dot(left: readonly number[], right: readonly number[]): number {
  return left.reduce((total, value, index) => total + value * (right[index] ?? 0), 0)
}
