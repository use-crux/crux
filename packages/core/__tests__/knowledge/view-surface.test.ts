import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { embedding } from '../../src/embedding'
import type { CruxChunk } from '../../src/indexing'
import { createKnowledgeGenerationStore, type KnowledgeGenerationWriter } from '../../src/knowledge/generation'
import { knowledgeAdjacencyInKey, knowledgeAdjacencyOutKey } from '../../src/knowledge/keys'
import { createKnowledgeEdgeRecord, type KnowledgeEdgeRecord } from '../../src/knowledge/records'
import type { KnowledgeRef } from '../../src/knowledge/refs'
import { expandRelations, knowledgeBase, retrieve } from '../../src/retrieval'
import { indexedChunkKey } from '../../src/indexed-knowledge/keys'
import { inMemoryStorage, type ExactFilter, type JsonObject, type VectorSearchQuery } from '../../src/storage'
import { textOf } from '../embedding/text-input'

const schema = z.object({
  status: z.enum(['open', 'closed']),
  team: z.string(),
})

describe('connected knowledge view surface', () => {
  it('keeps live revisions fresh while pinned handles replay the old member set', async () => {
    const docs = knowledgeBase({ id: 'docs', storage: inMemoryStorage(), embeddings: testEmbedding(), metadataSchema: schema })
    const view = docs.view({ id: 'open', where: { status: 'open' } })
    await docs.index([
      chunk({ sourceId: 'a', content: 'alpha', metadata: { status: 'open', team: 'core' } }),
      chunk({ sourceId: 'b', content: 'beta', metadata: { status: 'closed', team: 'core' } }),
    ])
    const first = await view.resolve()

    await docs.index([chunk({ sourceId: 'c', content: 'charlie', metadata: { status: 'open', team: 'docs' } })])
    const second = await view.resolve()

    expect(first.members).toEqual(['a'])
    expect(second.revisionHash).not.toBe(first.revisionHash)
    expect(second.members).toEqual(['a', 'c'])
    await expect(view.at(first.revisionHash).resolve()).resolves.toEqual(first)
  })

  it('fails exact replay when a pinned member source has changed', async () => {
    const docs = knowledgeBase({ id: 'docs', storage: inMemoryStorage(), embeddings: testEmbedding(), metadataSchema: schema })
    const view = docs.view({ id: 'open', where: { status: 'open' } })
    await docs.index([chunk({ sourceId: 'a', content: 'alpha', metadata: { status: 'open', team: 'core' } })])
    const first = await view.resolve()

    await docs.index([chunk({ sourceId: 'a', content: 'alpha changed', metadata: { status: 'open', team: 'core' } })])

    await expect(view.at(first.revisionHash).resolve()).rejects.toThrow(/not exactly replayable.*a/)
  })

  it('marks empty view backfills so they do not scan active records repeatedly', async () => {
    const storage = inMemoryStorage()
    const counted = countLists(storage.records)
    const docs = knowledgeBase({ id: 'docs', records: counted.records, metadataSchema: schema })
    const view = docs.view({ id: 'empty', where: { status: 'open' } })

    await view.resolve()
    await view.resolve()

    expect(counted.prefixes.filter((prefix) => prefix === 'indexer:docs:namespace:docs:')).toHaveLength(1)
  })

  it('rejects duplicate view ids with different predicates', () => {
    const docs = knowledgeBase({ id: 'docs', storage: inMemoryStorage(), embeddings: testEmbedding(), metadataSchema: schema })
    docs.view({ id: 'same', where: { status: 'open' } })

    expect(() => docs.view({ id: 'same', where: { team: 'core' } })).toThrow(/different where predicate/)
  })

  it('fans out disjunctive predicates into exact vector filters and unions hits', async () => {
    const storage = inMemoryStorage()
    const observed: ExactFilter[] = []
    const vectors = {
      ...storage.vectors!,
      search: async (query: VectorSearchQuery) => {
        if (query.filter) observed.push(query.filter)
        return storage.vectors!.search(query)
      },
    }
    const docs = knowledgeBase({ id: 'docs', records: storage.records, vectors, embeddings: testEmbedding(), metadataSchema: schema })
    await docs.index([
      chunk({ sourceId: 'a', content: 'alpha', metadata: { status: 'open', team: 'core' } }),
      chunk({ sourceId: 'b', content: 'beta', metadata: { status: 'closed', team: 'web' } }),
      chunk({ sourceId: 'c', content: 'charlie', metadata: { status: 'open', team: 'docs' } }),
    ])
    const view = docs.view({ id: 'fanout', where: { any: [{ status: ['open', 'closed'] }, { team: 'docs' }] } })

    const hits = await view.retriever().retrieve('anything', { limit: 10 })

    expect(hits.map((hit) => hit.source.id)).toEqual(['a', 'b', 'c'])
    expect(observed.map((filter) => pick(filter, ['status', 'team']))).toEqual([
      { status: 'closed' },
      { status: 'open' },
      { team: 'docs' },
    ])
  })

  it('throws an actionable diagnostic when branch expansion exceeds the ceiling', async () => {
    const docs = knowledgeBase({ id: 'docs', storage: inMemoryStorage(), embeddings: testEmbedding(), metadataSchema: schema })
    const view = docs.view({ id: 'wide', where: { team: Array.from({ length: 17 }, (_, index) => `team-${index}`) } })

    await expect(view.retriever().retrieve('anything')).rejects.toThrow(/17 vector filter branches.*at most 16.*Narrow/)
  })

  it('treats membership as authoritative after vector pushdown', async () => {
    const storage = inMemoryStorage()
    const docs = knowledgeBase({ id: 'docs', storage, embeddings: testEmbedding(), metadataSchema: schema })
    const view = docs.view({ id: 'open', where: { status: 'open' } })
    await docs.index([chunk({ sourceId: 'member', content: 'member', metadata: { status: 'open', team: 'core' } })])
    await expect(view.resolve()).resolves.toMatchObject({ members: ['member'] })
    await writeUnindexedVectorHit(storage, 'outside', { status: 'open', team: 'core' })

    const hits = await view.retriever().retrieve('anything', { limit: 10 })

    expect(hits.map((hit) => hit.source.id)).toEqual(['member'])
  })

  it('isolates scoped namespaces and hydrates only view members in recipes', async () => {
    const storage = inMemoryStorage()
    const docs = knowledgeBase({ id: 'docs', storage, embeddings: testEmbedding(), metadataSchema: schema })
    const scoped = docs.scope({ namespace: 'tenant-b' })
    await docs.index([chunk({ sourceId: 'root', content: 'root', metadata: { status: 'open', team: 'core' } })])
    await scoped.index([
      chunk({ namespace: 'tenant-b', sourceId: 'open', content: 'open seed', metadata: { status: 'open', team: 'core' } }),
      chunk({ namespace: 'tenant-b', sourceId: 'closed', content: 'closed target', metadata: { status: 'closed', team: 'core' } }),
    ])
    await publishEdge(storage.records, 'tenant-b', edge('tenant-b', chunkRef('open', 'main'), chunkRef('closed', 'main')))
    const view = scoped.view({ id: 'open', where: { status: 'open' } })

    await expect(view.resolve()).resolves.toMatchObject({ members: ['open'] })
    const hits = await view.recipe({
      id: 'scoped-open',
      steps: [retrieve({ limit: 1 }), expandRelations({ types: ['related'], direction: 'out' })],
    }).retrieve('open', { limit: 5 })

    expect(hits.map((hit) => `${hit.namespace}:${hit.source.id}`)).toEqual(['tenant-b:open'])
  })
})

function testEmbedding() {
  return embedding({
    kind: 'dense',
    name: 'view-surface-test',
    dimensions: 2,
    maxInputTokens: 100,
    batch: { maxSize: 8 },
    embed: async (inputs) => inputs.map((input) => (textOf(input).includes('closed') ? [0, 1] : [1, 0])),
  })
}

async function writeUnindexedVectorHit(
  storage: ReturnType<typeof inMemoryStorage>,
  sourceId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const key = indexedChunkKey('docs', 'docs', sourceId, 'main')
  await storage.records.put(key, {
    _cruxRecordType: 'chunk',
    namespace: 'docs',
    sourceId,
    chunkId: 'main',
    generationId: 'manual',
    active: true,
    ordinal: 0,
    content: sourceId,
    metadata: metadata as JsonObject,
    createdAt: 1,
    updatedAt: 1,
  })
  await storage.vectors!.upsert([{
    key,
    dense: [1, 0],
    metadata: { _cruxRecordType: 'chunk', namespace: 'docs', sourceId, chunkId: 'main', active: true, ...metadata },
  }])
}

async function publishEdge(records: ReturnType<typeof inMemoryStorage>['records'], namespace: string, record: KnowledgeEdgeRecord): Promise<void> {
  const generations = createKnowledgeGenerationStore({ records, indexerId: 'docs', namespace, retention: 'retain-inactive' })
  const writer = generations.beginGeneration(record.generationId)
  await writeEdge(writer, namespace, record)
  await writer.finish()
  await generations.publish(record.generationId)
}

async function writeEdge(writer: KnowledgeGenerationWriter, namespace: string, record: KnowledgeEdgeRecord): Promise<void> {
  await writer.putEdge(record)
  await writer.putRecord(
    knowledgeAdjacencyOutKey('docs', namespace, record.generationId, record.from, record.type, record.edgeId),
    { edgeId: record.edgeId, type: record.type, peerRef: record.to } as unknown as JsonObject,
  )
  await writer.putRecord(
    knowledgeAdjacencyInKey('docs', namespace, record.generationId, record.to, record.type, record.edgeId),
    { edgeId: record.edgeId, type: record.type, peerRef: record.from } as unknown as JsonObject,
  )
}

function edge(namespace: string, from: KnowledgeRef, to: KnowledgeRef): KnowledgeEdgeRecord {
  return createKnowledgeEdgeRecord({
    type: 'related',
    from,
    to,
    direction: 'directed',
    evidence: [],
    stageId: 'manual',
    stageVersion: 1,
    generationId: 'manual-gen',
    namespace,
    now: 1,
  })
}

function chunk(input: {
  readonly namespace?: string
  readonly sourceId: string
  readonly content: string
  readonly metadata: Record<string, unknown>
}): CruxChunk {
  return {
    namespace: input.namespace ?? 'docs',
    sourceId: input.sourceId,
    chunkId: 'main',
    ordinal: 0,
    content: input.content,
    metadata: input.metadata,
  }
}

function chunkRef(sourceId: string, chunkId: string): KnowledgeRef {
  return { kind: 'chunk', sourceId, chunkId }
}

function pick(filter: ExactFilter, keys: readonly string[]): ExactFilter {
  return Object.fromEntries(keys.flatMap((key) => filter[key] === undefined ? [] : [[key, filter[key]]])) as ExactFilter
}

function countLists(records: ReturnType<typeof inMemoryStorage>['records']): {
  readonly records: ReturnType<typeof inMemoryStorage>['records']
  readonly prefixes: string[]
} {
  const prefixes: string[] = []
  return {
    records: {
      ...records,
      list: async (prefix, options) => {
        prefixes.push(prefix)
        return records.list(prefix, options)
      },
    },
    prefixes,
  }
}
