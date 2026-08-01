import { describe, expect, it } from 'vitest'
import { createIndexedKnowledgeStore } from '../../src/indexed-knowledge'
import { indexedNamespacePrefix, listIndexedEntries } from '../../src/indexed-knowledge/keys'
import { createStructuralGraphReader } from '../../src/knowledge/structural'
import { inMemoryStorage } from '../../src/storage'
import type { CruxChunk, CruxParentChunk } from '../../src/indexing/types'
import type { RecordStore } from '../../src/storage'

const indexerId = 'docs'
const namespace = 'kb'

describe('virtual structural graph reader', () => {
  it('projects hierarchy neighbors for documents, parents, and chunks in both directions', async () => {
    const storage = inMemoryStorage()
    const graph = await persistFixture(storage.records, {
      chunks: [
        chunk({ chunkId: 'intro', ordinal: 1, parentId: 'overview' }),
        chunk({ chunkId: 'install', ordinal: 2, parentId: 'setup' }),
        chunk({ chunkId: 'appendix', ordinal: 3 }),
      ],
      parents: [
        parent({ parentId: 'setup', ordinal: 2 }),
        parent({ parentId: 'overview', ordinal: 1 }),
      ],
    })

    await expect(graph.neighbors(documentRef('guide'), { types: ['hierarchy'], direction: 'out' })).resolves.toEqual([
      { ref: parentRef('guide', 'overview'), type: 'hierarchy', direction: 'out' },
      { ref: parentRef('guide', 'setup'), type: 'hierarchy', direction: 'out' },
      { ref: chunkRef('guide', 'appendix'), type: 'hierarchy', direction: 'out' },
    ])

    await expect(graph.neighbors(parentRef('guide', 'overview'), { types: ['hierarchy'], direction: 'in' })).resolves.toEqual([
      { ref: documentRef('guide'), type: 'hierarchy', direction: 'in' },
    ])
    await expect(graph.neighbors(parentRef('guide', 'overview'), { types: ['hierarchy'], direction: 'out' })).resolves.toEqual([
      { ref: chunkRef('guide', 'intro'), type: 'hierarchy', direction: 'out' },
    ])

    await expect(graph.neighbors(chunkRef('guide', 'intro'), { types: ['hierarchy'], direction: 'in' })).resolves.toEqual([
      { ref: parentRef('guide', 'overview'), type: 'hierarchy', direction: 'in' },
    ])
    await expect(graph.neighbors(chunkRef('guide', 'appendix'), { types: ['hierarchy'], direction: 'in' })).resolves.toEqual([
      { ref: documentRef('guide'), type: 'hierarchy', direction: 'in' },
    ])
  })

  it('projects sequence neighbors by active chunk ordinal', async () => {
    const storage = inMemoryStorage()
    const graph = await persistFixture(storage.records, {
      chunks: [
        chunk({ chunkId: 'last', ordinal: 30 }),
        chunk({ chunkId: 'first', ordinal: 10 }),
        chunk({ chunkId: 'middle', ordinal: 20 }),
      ],
      parents: [],
    })

    await expect(graph.neighbors(chunkRef('guide', 'first'), { types: ['sequence'], direction: 'out' })).resolves.toEqual([
      { ref: chunkRef('guide', 'middle'), type: 'sequence', direction: 'out' },
    ])
    await expect(graph.neighbors(chunkRef('guide', 'middle'), { types: ['sequence'] })).resolves.toEqual([
      { ref: chunkRef('guide', 'first'), type: 'sequence', direction: 'in' },
      { ref: chunkRef('guide', 'last'), type: 'sequence', direction: 'out' },
    ])
    await expect(graph.neighbors(chunkRef('guide', 'last'), { types: ['sequence'], direction: 'out' })).resolves.toEqual([])
  })

  it('projects nothing from inactive records', async () => {
    const storage = inMemoryStorage()
    const records = createIndexedKnowledgeStore({ indexerId, namespace, records: storage.records })

    await records.persistGeneration({
      chunks: [chunk({ chunkId: 'old', ordinal: 1, content: 'old' })],
      parents: [parent({ parentId: 'old-parent', ordinal: 1, content: 'old parent' })],
      replaceSources: true,
      now: 1,
    })
    await records.persistGeneration({
      chunks: [chunk({ chunkId: 'new', ordinal: 1, parentId: 'new-parent', content: 'new' })],
      parents: [parent({ parentId: 'new-parent', ordinal: 1, content: 'new parent' })],
      replaceSources: true,
      now: 2,
    })

    const graph = createStructuralGraphReader({ records: storage.records, indexerId, namespace })

    await expect(graph.neighbors(chunkRef('guide', 'old'))).resolves.toEqual([])
    await expect(graph.neighbors(parentRef('guide', 'old-parent'))).resolves.toEqual([])
    await expect(graph.neighbors(documentRef('guide'), { types: ['hierarchy'] })).resolves.toEqual([
      { ref: parentRef('guide', 'new-parent'), type: 'hierarchy', direction: 'out' },
    ])
  })

  it('applies type, direction, and limit filters in deterministic order', async () => {
    const storage = inMemoryStorage()
    const graph = await persistFixture(storage.records, {
      chunks: [
        chunk({ chunkId: 'b', ordinal: 2 }),
        chunk({ chunkId: 'a', ordinal: 1 }),
        chunk({ chunkId: 'same-b', ordinal: 1 }),
        chunk({ chunkId: 'same-a', ordinal: 1 }),
      ],
      parents: [],
    })

    await expect(graph.neighbors(documentRef('guide'), { types: ['hierarchy'], direction: 'out', limit: 2 })).resolves.toEqual([
      { ref: chunkRef('guide', 'a'), type: 'hierarchy', direction: 'out' },
      { ref: chunkRef('guide', 'same-a'), type: 'hierarchy', direction: 'out' },
    ])
    await expect(graph.neighbors(documentRef('guide'), { types: ['sequence'] })).resolves.toEqual([])
    await expect(graph.neighbors(chunkRef('guide', 'same-a'), { direction: 'out' })).resolves.toEqual([
      { ref: chunkRef('guide', 'same-b'), type: 'sequence', direction: 'out' },
    ])
  })

  it('does not write records while serving virtual neighbors', async () => {
    const storage = inMemoryStorage()
    const graph = await persistFixture(storage.records, {
      chunks: [chunk({ chunkId: 'a', ordinal: 1 }), chunk({ chunkId: 'b', ordinal: 2 })],
      parents: [],
    })
    const before = await recordKeys(storage.records)

    await graph.neighbors(documentRef('guide'))
    await graph.neighbors(chunkRef('guide', 'a'), { types: ['sequence'], direction: 'out' })
    await graph.neighbors(chunkRef('guide', 'b'), { direction: 'in', limit: 1 })

    await expect(recordKeys(storage.records)).resolves.toEqual(before)
    expect(before.some((key) => key.includes(':knowledge:'))).toBe(false)
  })
})

async function persistFixture(
  records: RecordStore,
  input: {
    readonly chunks: readonly CruxChunk[]
    readonly parents: readonly CruxParentChunk[]
  },
) {
  const indexed = createIndexedKnowledgeStore({ indexerId, namespace, records })
  await indexed.persistGeneration({
    chunks: input.chunks,
    parents: input.parents,
    replaceSources: true,
    now: 1,
  })
  return createStructuralGraphReader({ records, indexerId, namespace })
}

async function recordKeys(records: RecordStore): Promise<string[]> {
  const entries = await listIndexedEntries(records, indexedNamespacePrefix(indexerId, namespace))
  return entries.map((entry) => entry.key)
}

function documentRef(sourceId: string) {
  return { kind: 'document' as const, sourceId }
}

function parentRef(sourceId: string, parentId: string) {
  return { kind: 'parent' as const, sourceId, parentId }
}

function chunkRef(sourceId: string, chunkId: string) {
  return { kind: 'chunk' as const, sourceId, chunkId }
}

function chunk(input: {
  readonly chunkId: string
  readonly ordinal: number
  readonly parentId?: string
  readonly content?: string
}): CruxChunk {
  return {
    namespace,
    sourceId: 'guide',
    chunkId: input.chunkId,
    ordinal: input.ordinal,
    content: input.content ?? input.chunkId,
    metadata: {},
    ...(input.parentId ? { parent: { parentId: input.parentId } } : {}),
  }
}

function parent(input: {
  readonly parentId: string
  readonly ordinal: number
  readonly content?: string
}): CruxParentChunk {
  return {
    namespace,
    sourceId: 'guide',
    parentId: input.parentId,
    ordinal: input.ordinal,
    content: input.content ?? input.parentId,
    metadata: {},
  }
}
