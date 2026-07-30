import { describe, expect, it } from 'vitest'
import { createIndexedKnowledgeStore } from '../../src/indexed-knowledge'
import { createKnowledgeGenerationStore, type KnowledgeGenerationWriter } from '../../src/knowledge/generation'
import { createKnowledgeGraphStore } from '../../src/knowledge/graph-store'
import {
  knowledgeAdjacencyInKey,
  knowledgeAdjacencyOutKey,
  knowledgeEdgeKey,
} from '../../src/knowledge/keys'
import { createKnowledgeEdgeRecord, type KnowledgeEdgeRecord } from '../../src/knowledge/records'
import { inMemoryStorage, type JsonObject, type RecordStore } from '../../src/storage'
import type { CruxChunk, CruxParentChunk } from '../../src/indexing/types'
import type { KnowledgeRef } from '../../src/knowledge/refs'

const indexerId = 'docs'
const namespace = 'kb'

describe('knowledge graph store', () => {
  it('returns structural neighbors only when no generation is published', async () => {
    const { records } = inMemoryStorage()
    await persistIndexed(records, {
      chunks: [chunk({ chunkId: 'intro', ordinal: 1, parentId: 'overview' })],
      parents: [parent({ parentId: 'overview', ordinal: 1 })],
    })
    const graph = createKnowledgeGraphStore({ records, indexerId, namespace })

    await expect(graph.neighbors(documentRef('guide'))).resolves.toEqual([
      { ref: parentRef('guide', 'overview'), type: 'hierarchy', direction: 'out' },
    ])
  })

  it('layers published semantic edges with structural neighbors and filters types across both', async () => {
    const { records } = inMemoryStorage()
    await persistIndexed(records, {
      chunks: [chunk({ chunkId: 'intro', ordinal: 1 })],
      parents: [],
    })
    await publishEdges(records, namespace, 'gen-1', [
      edge('gen-1', namespace, 'mentions', documentRef('guide'), entityRef('crux')),
      edge('gen-1', namespace, 'mentions', documentRef('guide'), entityRef('alpha')),
    ])
    const graph = createKnowledgeGraphStore({ records, indexerId, namespace })

    await expect(graph.neighbors(documentRef('guide'))).resolves.toEqual([
      { ref: chunkRef('guide', 'intro'), type: 'hierarchy', direction: 'out' },
      { ref: entityRef('alpha'), type: 'mentions', direction: 'out' },
      { ref: entityRef('crux'), type: 'mentions', direction: 'out' },
    ])
    await expect(graph.neighbors(documentRef('guide'), { types: ['mentions'] })).resolves.toEqual([
      { ref: entityRef('alpha'), type: 'mentions', direction: 'out' },
      { ref: entityRef('crux'), type: 'mentions', direction: 'out' },
    ])
    await expect(graph.neighbors(documentRef('guide'), { types: ['hierarchy'] })).resolves.toEqual([
      { ref: chunkRef('guide', 'intro'), type: 'hierarchy', direction: 'out' },
    ])
    await expect(graph.neighbors(documentRef('guide'), { limit: 2 })).resolves.toEqual([
      { ref: chunkRef('guide', 'intro'), type: 'hierarchy', direction: 'out' },
      { ref: entityRef('alpha'), type: 'mentions', direction: 'out' },
    ])
    await expect(graph.neighbors(entityRef('alpha'), { direction: 'in' })).resolves.toEqual([
      { ref: documentRef('guide'), type: 'mentions', direction: 'in' },
    ])
  })

  it('pins the published generation for a reader while fresh readers see the new pointer', async () => {
    const { records } = inMemoryStorage()
    await publishEdges(records, namespace, 'gen-1', [
      edge('gen-1', namespace, 'mentions', documentRef('guide'), entityRef('old')),
    ])
    const pinned = createKnowledgeGraphStore({ records, indexerId, namespace })

    await expect(pinned.neighbors(documentRef('guide'))).resolves.toEqual([
      { ref: entityRef('old'), type: 'mentions', direction: 'out' },
    ])

    await publishEdges(records, namespace, 'gen-2', [
      edge('gen-2', namespace, 'mentions', documentRef('guide'), entityRef('new')),
    ])

    await expect(pinned.neighbors(documentRef('guide'))).resolves.toEqual([
      { ref: entityRef('old'), type: 'mentions', direction: 'out' },
    ])
    await expect(createKnowledgeGraphStore({ records, indexerId, namespace }).neighbors(documentRef('guide'))).resolves.toEqual([
      { ref: entityRef('new'), type: 'mentions', direction: 'out' },
    ])
  })

  it('keeps namespace-bound readers from seeing edges in other namespaces', async () => {
    const { records } = inMemoryStorage()
    await publishEdges(records, 'team-a', 'gen-1', [
      edge('gen-1', 'team-a', 'mentions', documentRef('guide'), entityRef('crux')),
    ])
    const graph = createKnowledgeGraphStore({ records, indexerId, namespace: 'team-b' })

    await expect(graph.neighbors(documentRef('guide'))).resolves.toEqual([])
  })

  it('hydrates active chunk refs and returns null for inactive, missing, or non-chunk refs', async () => {
    const { records } = inMemoryStorage()
    const graph = createKnowledgeGraphStore({ records, indexerId, namespace })
    await persistIndexed(records, {
      chunks: [chunk({ chunkId: 'active', ordinal: 1, content: 'Active content', metadata: { section: 'intro' } })],
      parents: [],
    })

    await expect(graph.hydrate(chunkRef('guide', 'active'))).resolves.toMatchObject({
      namespace,
      source: { id: 'guide' },
      chunkId: 'active',
      content: 'Active content',
      metadata: { section: 'intro' },
      score: 0,
    })

    await persistIndexed(records, {
      chunks: [chunk({ chunkId: 'replacement', ordinal: 1 })],
      parents: [],
      now: 2,
    })

    await expect(graph.hydrate(chunkRef('guide', 'active'))).resolves.toBeNull()
    await expect(graph.hydrate(chunkRef('guide', 'missing'))).resolves.toBeNull()
    await expect(graph.hydrate(documentRef('guide'))).resolves.toBeNull()
  })

  it('skips malformed edge records under scanned adjacency prefixes', async () => {
    const { records } = inMemoryStorage()
    const generations = createKnowledgeGenerationStore({ records, indexerId, namespace })
    const writer = generations.beginGeneration('gen-1')
    const valid = edge('gen-1', namespace, 'mentions', documentRef('guide'), entityRef('crux'))

    await writeEdge(writer, namespace, valid)
    await writer.putRecord(
      knowledgeAdjacencyOutKey(indexerId, namespace, 'gen-1', documentRef('guide'), 'mentions', 'bad-edge'),
      { edgeId: 'bad-edge', type: 'mentions', peerRef: entityRef('bad') } as unknown as JsonObject,
    )
    await writer.putRecord(
      knowledgeEdgeKey(indexerId, namespace, 'gen-1', 'bad-edge'),
      { _cruxRecordType: 'knowledge-edge', edgeId: 'bad-edge' },
    )
    await writer.finish()
    await generations.publish('gen-1')

    const graph = createKnowledgeGraphStore({ records, indexerId, namespace })

    await expect(graph.neighbors(documentRef('guide'))).resolves.toEqual([
      { ref: entityRef('crux'), type: 'mentions', direction: 'out' },
    ])
  })
})

async function persistIndexed(
  records: RecordStore,
  input: {
    readonly chunks: readonly CruxChunk[]
    readonly parents: readonly CruxParentChunk[]
    readonly now?: number
  },
): Promise<void> {
  const indexed = createIndexedKnowledgeStore({ records, indexerId, namespace })
  await indexed.persistGeneration({
    chunks: input.chunks,
    parents: input.parents,
    replaceSources: true,
    now: input.now ?? 1,
  })
}

async function publishEdges(
  records: RecordStore,
  edgeNamespace: string,
  generationId: string,
  edges: readonly KnowledgeEdgeRecord[],
): Promise<void> {
  const generations = createKnowledgeGenerationStore({
    records,
    indexerId,
    namespace: edgeNamespace,
    retention: 'retain-inactive',
  })
  const writer = generations.beginGeneration(generationId)
  for (const record of edges) {
    await writeEdge(writer, edgeNamespace, record)
  }
  await writer.finish()
  await generations.publish(generationId)
}

async function writeEdge(
  writer: KnowledgeGenerationWriter,
  edgeNamespace: string,
  record: KnowledgeEdgeRecord,
): Promise<void> {
  await writer.putEdge(record)
  await writer.putRecord(
    knowledgeAdjacencyOutKey(indexerId, edgeNamespace, record.generationId, record.from, record.type, record.edgeId),
    { edgeId: record.edgeId, type: record.type, peerRef: record.to } as unknown as JsonObject,
  )
  await writer.putRecord(
    knowledgeAdjacencyInKey(indexerId, edgeNamespace, record.generationId, record.to, record.type, record.edgeId),
    { edgeId: record.edgeId, type: record.type, peerRef: record.from } as unknown as JsonObject,
  )
}

function edge(
  generationId: string,
  edgeNamespace: string,
  type: string,
  from: KnowledgeRef,
  to: KnowledgeRef,
): KnowledgeEdgeRecord {
  return createKnowledgeEdgeRecord({
    type,
    from,
    to,
    direction: 'directed',
    evidence: [],
    stageId: 'manual',
    stageVersion: 1,
    generationId,
    namespace: edgeNamespace,
    now: 1,
  })
}

function documentRef(sourceId: string): KnowledgeRef {
  return { kind: 'document', sourceId }
}

function parentRef(sourceId: string, parentId: string): KnowledgeRef {
  return { kind: 'parent', sourceId, parentId }
}

function chunkRef(sourceId: string, chunkId: string): KnowledgeRef {
  return { kind: 'chunk', sourceId, chunkId }
}

function entityRef(entityId: string): KnowledgeRef {
  return { kind: 'entity', entityId }
}

function chunk(input: {
  readonly chunkId: string
  readonly ordinal: number
  readonly parentId?: string
  readonly content?: string
  readonly metadata?: Record<string, unknown>
}): CruxChunk {
  return {
    namespace,
    sourceId: 'guide',
    chunkId: input.chunkId,
    ordinal: input.ordinal,
    content: input.content ?? input.chunkId,
    metadata: input.metadata ?? {},
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
