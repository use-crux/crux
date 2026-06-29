import { describe, expect, it } from 'vitest'
import {
  createStoreDocCodec,
  createStoreDocStore,
  STORE_DOC_COMPONENT_SPEC,
  type StoreDocComponentPort,
  type StoreDocRecord,
  type StoreDocWrite,
} from '../store-doc'

describe('store document codec', () => {
  it('encodes and decodes current Crux store documents', () => {
    const codec = createStoreDocCodec({ now: () => 1_000 })
    const write = codec.encode(
      'memory:alpha',
      {
        content: 'Alpha',
        namespace: 'kb',
        embedding: [0.1, 0.2, 0.3],
      },
      { ttl: 500 },
    )

    expect(write).toEqual({
      key: 'memory:alpha',
      content: JSON.stringify({
        content: 'Alpha',
        namespace: 'kb',
        embedding: [0.1, 0.2, 0.3],
        [STORE_DOC_COMPONENT_SPEC.fields.expiresAt]: 1_500,
      }),
      metadata: { [STORE_DOC_COMPONENT_SPEC.fields.marker]: true },
      embedding: [0.1, 0.2, 0.3],
      updatedAt: 1_000,
    })

    expect(codec.decode(write)).toEqual({
      key: 'memory:alpha',
      value: {
        content: 'Alpha',
        namespace: 'kb',
        embedding: [0.1, 0.2, 0.3],
        [STORE_DOC_COMPONENT_SPEC.fields.expiresAt]: 1_500,
      },
      expired: false,
      expiresAt: 1_500,
      encoding: 'crux-doc',
    })
  })

  it('rejects documents that were not written in the current Crux store format', () => {
    const codec = createStoreDocCodec()

    expect(() =>
      codec.decode({
        key: 'memory:alpha',
        content: JSON.stringify({ content: 'Alpha' }),
        metadata: { source: 'import' },
      }),
    ).toThrow(/current Crux store format/i)
  })
})

describe('store document store', () => {
  it('suppresses expired documents, deletes them lazily, filters consistently, and reports capabilities', async () => {
    const expired = cruxDoc(
      'memory:expired',
      {
        content: 'Old',
        namespace: 'kb',
        [STORE_DOC_COMPONENT_SPEC.fields.expiresAt]: 900,
      },
      0.99,
    )
    const fresh = cruxDoc(
      'memory:fresh',
      {
        content: 'Fresh',
        namespace: 'kb',
        [STORE_DOC_COMPONENT_SPEC.fields.expiresAt]: 2_000,
      },
      0.88,
    )
    const other = cruxDoc('memory:other', { content: 'Other', namespace: 'other' }, 0.95)
    const { io, writes, deletes } = mapStoreDocIo([expired, fresh, other], [expired, fresh, other], () => 1_000)
    const store = createStoreDocStore({
      io,
      now: () => 1_000,
      denseVectorSearch: true,
      semanticCache: { isolatedVectorNamespace: true },
    })

    await store.set('memory:new', { content: 'New', embedding: [0.1, 0.2], namespace: 'kb' }, { ttl: 250 })
    await expect(store.setIfAbsent('memory:new', { content: 'Replacement' })).resolves.toBe(false)
    await expect(store.setIfAbsent('memory:inserted', { content: 'Inserted' })).resolves.toBe(true)

    expect(writes).toEqual([
      {
        key: 'memory:new',
        content: JSON.stringify({
          content: 'New',
          embedding: [0.1, 0.2],
          namespace: 'kb',
          [STORE_DOC_COMPONENT_SPEC.fields.expiresAt]: 1_250,
        }),
        metadata: { [STORE_DOC_COMPONENT_SPEC.fields.marker]: true },
        embedding: [0.1, 0.2],
        updatedAt: 1_000,
      },
      {
        key: 'memory:inserted',
        content: JSON.stringify({ content: 'Inserted' }),
        metadata: { [STORE_DOC_COMPONENT_SPEC.fields.marker]: true },
        updatedAt: 1_000,
      },
    ])

    await expect(store.get('memory:expired')).resolves.toBeNull()
    await expect(store.get('memory:fresh')).resolves.toEqual({
      content: 'Fresh',
      namespace: 'kb',
      [STORE_DOC_COMPONENT_SPEC.fields.expiresAt]: 2_000,
    })

    await expect(store.list('memory:', { filter: { namespace: 'kb' } })).resolves.toEqual({
      entries: [
        {
          key: 'memory:fresh',
          value: {
            content: 'Fresh',
            namespace: 'kb',
            [STORE_DOC_COMPONENT_SPEC.fields.expiresAt]: 2_000,
          },
        },
        {
          key: 'memory:new',
          value: {
            content: 'New',
            embedding: [0.1, 0.2],
            namespace: 'kb',
            [STORE_DOC_COMPONENT_SPEC.fields.expiresAt]: 1_250,
          },
        },
      ],
    })

    await expect(
      store.searchVectors!({
        dense: [0.2, 0.3],
        threshold: 0.8,
        filter: { namespace: 'kb' },
      }),
    ).resolves.toEqual([
      {
        key: 'memory:fresh',
        value: {
          content: 'Fresh',
          namespace: 'kb',
          [STORE_DOC_COMPONENT_SPEC.fields.expiresAt]: 2_000,
        },
        score: 0.88,
      },
    ])

    expect(deletes).toEqual(['memory:expired', 'memory:expired', 'memory:expired'])
    expect(store.supportsTtl?.()).toBe(true)
    expect(store.capabilities?.()).toEqual({
      ttl: true,
      vectorSearch: { dense: true, sparse: false, hybrid: false },
      semanticCache: { isolatedVectorNamespace: true },
    })
  })

  it('rejects unsupported sparse and hybrid vector queries with explicit errors', async () => {
    const { io } = mapStoreDocIo([])
    const store = createStoreDocStore({ io, denseVectorSearch: true })

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

  it('treats expired documents as absent in the atomic insert path', async () => {
    const expired = cruxDoc('memory:expired', {
      content: 'Old',
      [STORE_DOC_COMPONENT_SPEC.fields.expiresAt]: 900,
    })
    const { io, writes } = mapStoreDocIo([expired], [expired], () => 1_000)
    const store = createStoreDocStore({ io, now: () => 1_000 })

    await expect(store.setIfAbsent('memory:expired', { content: 'Replacement' })).resolves.toBe(true)
    await expect(store.get('memory:expired')).resolves.toEqual({ content: 'Replacement' })
    expect(writes).toEqual([
      {
        key: 'memory:expired',
        content: JSON.stringify({ content: 'Replacement' }),
        metadata: { [STORE_DOC_COMPONENT_SPEC.fields.marker]: true },
        updatedAt: 1_000,
      },
    ])
  })
})

function cruxDoc(key: string, value: StoreDocRecord, score?: number): StoreDocRecord {
  return {
    key,
    content: JSON.stringify(value),
    metadata: { [STORE_DOC_COMPONENT_SPEC.fields.marker]: true },
    createdAt: 1,
    updatedAt: 2,
    ...(score === undefined ? {} : { _score: score }),
  }
}

function mapStoreDocIo(
  initialDocs: readonly StoreDocRecord[],
  vectorDocs: readonly StoreDocRecord[] = initialDocs,
  now: () => number = Date.now,
): {
  io: StoreDocComponentPort
  writes: StoreDocWrite[]
  deletes: string[]
} {
  const docs = new Map(initialDocs.map((doc) => [String(doc.key), doc]))
  const writes: StoreDocWrite[] = []
  const deletes: string[] = []
  const io: StoreDocComponentPort = {
    async get(key) {
      return docs.get(key) ?? null
    },
    async list(query) {
      return {
        docs: [...docs.values()].filter((doc) => String(doc.key).startsWith(query.prefix)),
      }
    },
    async put(doc) {
      writes.push(doc)
      docs.set(doc.key, doc)
    },
    async insert(doc) {
      const existing = docs.get(doc.key)
      if (existing && !isExpiredStoreDoc(existing, now)) return false
      writes.push(doc)
      docs.set(doc.key, doc)
      return true
    },
    async delete(key) {
      deletes.push(key)
    },
    async searchDense() {
      return vectorDocs
    },
  }
  return { io, writes, deletes }
}

function isExpiredStoreDoc(doc: StoreDocRecord, now: () => number): boolean {
  const metadata = doc.metadata as Record<string, unknown> | undefined
  if (metadata?.[STORE_DOC_COMPONENT_SPEC.fields.marker] !== true || typeof doc.content !== 'string') {
    return false
  }

  try {
    const value = JSON.parse(doc.content) as Record<string, unknown>
    const expiresAt = value[STORE_DOC_COMPONENT_SPEC.fields.expiresAt]
    return typeof expiresAt === 'number' && now() >= expiresAt
  } catch {
    return false
  }
}
