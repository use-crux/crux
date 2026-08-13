import { describe, expect, it } from 'vitest'
import { createIndexedKnowledgeStore } from '../../src/indexed-knowledge'
import { listIndexedEntries } from '../../src/indexed-knowledge/keys'
import { createKnowledgeInspectionProjection } from '../../src/knowledge/inspection'
import { inMemoryStorage } from '../../src/storage'
import type { KnowledgeGraphReader, KnowledgeNeighbor } from '../../src/knowledge/graph-types'
import type { KnowledgeRef } from '../../src/knowledge/refs'
import type { CruxChunk, CruxParentChunk } from '../../src/indexing/types'
import type { RecordStore } from '../../src/storage'
import { schema2TextChunk } from '../fixtures/schema2-stored-evidence'

const indexerId = 'docs'
const namespace = 'kb'

describe('knowledge inspection projection', () => {
  it('summarizes active indexed records and excludes inactive records', async () => {
    const storage = inMemoryStorage()
    const indexed = createIndexedKnowledgeStore({ indexerId, namespace, records: storage.records })
    await indexed.persistGeneration({
      chunks: [chunk({ sourceId: 'guide', chunkId: 'old', ordinal: 1 })],
      parents: [parent({ sourceId: 'guide', parentId: 'old-parent', ordinal: 1 })],
      replaceSources: true,
      now: 1,
    })
    await indexed.persistGeneration({
      chunks: [
        chunk({ sourceId: 'guide', chunkId: 'intro', ordinal: 1, parentId: 'overview' }),
        chunk({ sourceId: 'guide', chunkId: 'install', ordinal: 2, parentId: 'overview' }),
        chunk({ sourceId: 'api', chunkId: 'start', ordinal: 1 }),
      ],
      parents: [parent({ sourceId: 'guide', parentId: 'overview', ordinal: 1 })],
      replaceSources: true,
      now: 2,
    })

    const projection = createProjection(storage.records, {
      generation: { published: true, generationId: 'graph-1' },
    })

    await expect(projection.summary()).resolves.toEqual({
      sources: [
        { sourceId: 'api', documents: 1, parents: 0, chunks: 1 },
        { sourceId: 'guide', documents: 1, parents: 1, chunks: 2 },
      ],
      totals: { documents: 2, parents: 1, chunks: 3 },
      generation: { published: true, generationId: 'graph-1' },
    })
  })

  it('returns zero counts and no generation for an empty corpus', async () => {
    const storage = inMemoryStorage()
    const projection = createProjection(storage.records)

    await expect(projection.summary()).resolves.toEqual({
      sources: [],
      totals: { documents: 0, parents: 0, chunks: 0 },
      generation: { published: false },
    })
    await expect(projection.summary({ sourceIds: ['missing'] })).resolves.toEqual({
      sources: [{ sourceId: 'missing', documents: 0, parents: 0, chunks: 0 }],
      totals: { documents: 0, parents: 0, chunks: 0 },
      generation: { published: false },
    })
  })

  it('passes neighbor refs and options through to the injected graph reader', async () => {
    const storage = inMemoryStorage()
    const ref = chunkRef('guide', 'intro')
    const options = { types: ['hierarchy'], direction: 'out' as const, limit: 2 }
    const neighbors: KnowledgeNeighbor[] = [
      { ref: parentRef('guide', 'overview'), type: 'hierarchy', direction: 'out' },
    ]
    const calls: { ref: KnowledgeRef; options: typeof options | undefined }[] = []
    const graph: KnowledgeGraphReader = {
      async neighbors(receivedRef, receivedOptions) {
        calls.push({ ref: receivedRef, options: receivedOptions as typeof options })
        return neighbors
      },
    }
    const projection = createProjection(storage.records, { graph })

    await expect(projection.neighbors(ref, options)).resolves.toBe(neighbors)
    expect(calls).toEqual([{ ref, options }])
  })

  it('performs zero writes while reading summaries and neighbors', async () => {
    const storage = inMemoryStorage()
    const indexed = createIndexedKnowledgeStore({ indexerId, namespace, records: storage.records })
    await indexed.persistGeneration({
      chunks: [chunk({ sourceId: 'guide', chunkId: 'intro', ordinal: 1 })],
      parents: [],
      replaceSources: true,
      now: 1,
    })
    const projection = createProjection(storage.records)
    const before = await recordKeys(storage.records)

    await projection.summary()
    await projection.summary({ sourceIds: ['guide', 'missing'] })
    await projection.neighbors(documentRef('guide'), { types: ['hierarchy'] })

    await expect(recordKeys(storage.records)).resolves.toEqual(before)
  })
})

function createProjection(
  records: RecordStore,
  options: {
    readonly graph?: KnowledgeGraphReader
    readonly generation?: Parameters<typeof createKnowledgeInspectionProjection>[0]['generation']
  } = {},
) {
  return createKnowledgeInspectionProjection({
    records,
    indexerId,
    namespace,
    graph: options.graph ?? {
      async neighbors() {
        return []
      },
    },
    generation: options.generation,
  })
}

async function recordKeys(records: RecordStore): Promise<string[]> {
  const entries = await listIndexedEntries(records, '')
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
  readonly sourceId: string
  readonly chunkId: string
  readonly ordinal: number
  readonly parentId?: string
}): CruxChunk {
  return schema2TextChunk({
    namespace,
    sourceId: input.sourceId,
    chunkId: input.chunkId,
    ordinal: input.ordinal,
    content: input.chunkId,
    metadata: {},
    ...(input.parentId ? { parent: { parentId: input.parentId } } : {}),
  })
}

function parent(input: {
  readonly sourceId: string
  readonly parentId: string
  readonly ordinal: number
}): CruxParentChunk {
  return {
    namespace,
    sourceId: input.sourceId,
    parentId: input.parentId,
    ordinal: input.ordinal,
    content: input.parentId,
    metadata: {},
  }
}
