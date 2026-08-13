import { describe, expect, it } from 'vitest'
import { createIndexedKnowledgeStore } from '../../src/indexed-knowledge'
import type { CruxChunk, CruxDocument } from '../../src/indexing'
import { compileKnowledgeGeneration, deleteKnowledgeClaimsForSource } from '../../src/knowledge/compile'
import { runDeriveStages } from '../../src/knowledge/derive/runner'
import { createKnowledgeGraphStore } from '../../src/knowledge/graph-store'
import { knowledgeClaimsKey } from '../../src/knowledge/keys'
import { relate } from '../../src/knowledge/relate/relate'
import type { KnowledgeRef } from '../../src/knowledge/refs'
import { inMemoryStorage, type RecordStore } from '../../src/storage'
import { schema2TextChunk } from '../fixtures/schema2-stored-evidence'

const indexerId = 'kb'
const namespace = 'kb'

describe('compileKnowledgeGeneration', () => {
  it('resolves ref and title-locator claims, keeps ambiguous and missing locators pending, then resolves later targets', async () => {
    const { records } = inMemoryStorage()
    await persistChunks(records, [
      chunk('alpha', 'a1', 'Alpha cites Beta and Gamma', { title: 'Alpha' }),
      chunk('beta', 'b1', 'Beta source', { title: 'Beta' }),
      chunk('shared-a', 's1', 'Shared source A', { title: 'Shared' }),
      chunk('shared-b', 's1', 'Shared source B', { title: 'Shared' }),
    ])
    const stage = relate({
      id: 'refs',
      version: 1,
      types: { cites: relation(['chunk'], ['document'], 'directed') },
      run: (_input, api) => {
        const from = chunkRef('alpha', 'a1')
        api.emit('cites', from, documentRef('beta'), { evidence: from, provenance: 'exact' })
        api.emit('cites', from, { title: 'Beta' }, { evidence: from, provenance: 'exact' })
        api.emit('cites', from, { title: 'Shared' }, { evidence: from, provenance: 'exact' })
        api.emit('cites', from, { title: 'Gamma' }, { evidence: from, provenance: 'exact' })
      },
    })
    await runDeriveStages({
      records,
      indexerId,
      namespace,
      stages: [stage],
      document: document('alpha'),
      chunks: [chunk('alpha', 'a1', 'Alpha cites Beta and Gamma')],
    })

    const first = await compileKnowledgeGeneration({ records, indexerId, namespace, retention: 'retain-inactive' })
    expect(first.edges).toHaveLength(1)
    expect(first.edges[0]).toMatchObject({
      type: 'cites',
      from: chunkRef('alpha', 'a1'),
      to: documentRef('beta'),
      evidence: [expect.objectContaining({ sourceId: 'alpha', chunkRef: chunkRef('alpha', 'a1') })],
    })
    expect(first.pendingClaims).toHaveLength(2)
    await expect(pendingStatuses(records, 'refs', 'alpha')).resolves.toContain('pending')

    await persistChunks(records, [chunk('gamma', 'g1', 'Gamma source', { title: 'Gamma' })])
    const second = await compileKnowledgeGeneration({ records, indexerId, namespace, retention: 'retain-inactive' })
    expect(second.edges.map((edge) => [edge.from, edge.to])).toEqual([
      [chunkRef('alpha', 'a1'), documentRef('beta')],
      [chunkRef('alpha', 'a1'), documentRef('gamma')],
    ])
    expect(second.pendingClaims).toHaveLength(1)

    const graph = createKnowledgeGraphStore({ records, indexerId, namespace })
    await expect(graph.neighbors(chunkRef('alpha', 'a1'), { types: ['cites'], direction: 'out' })).resolves.toEqual([
      { ref: documentRef('beta'), type: 'cites', direction: 'out' },
      { ref: documentRef('gamma'), type: 'cites', direction: 'out' },
    ])
  })

  it('merges edge supports and source removal drops only removed supports before removing the edge', async () => {
    const { records } = inMemoryStorage()
    await persistChunks(records, [
      chunk('subject', 'subject-1', 'Subject'),
      chunk('source-a', 'a1', 'A supports relation'),
      chunk('source-b', 'b1', 'B supports relation'),
      chunk('target', 't1', 'Target'),
    ])
    const stage = relate({
      id: 'supporters',
      version: 1,
      types: { supports: relation(['document'], ['document'], 'directed') },
      run: (input, api) => {
        const evidence = chunkRef(input.document.sourceId, input.chunks[0]?.chunkId ?? 'missing')
        api.emit('supports', documentRef('subject'), documentRef('target'), { evidence, provenance: 'exact' })
      },
    })
    for (const sourceId of ['source-a', 'source-b']) {
      await runDeriveStages({
        records,
        indexerId,
        namespace,
        stages: [stage],
        document: document(sourceId),
        chunks: [chunk(sourceId, sourceId === 'source-a' ? 'a1' : 'b1', 'support')],
      })
    }

    const first = await compileKnowledgeGeneration({ records, indexerId, namespace, retention: 'retain-inactive' })
    expect(first.edges).toHaveLength(1)
    expect(first.edges[0]?.evidence.map((support) => support.sourceId)).toEqual(['source-a', 'source-b'])
    const pinned = createKnowledgeGraphStore({ records, indexerId, namespace })
    await expect(pinned.neighbors(documentRef('subject'), { types: ['supports'] })).resolves.toHaveLength(1)

    await removeSource(records, 'source-a', ['supporters'])
    const second = await compileKnowledgeGeneration({ records, indexerId, namespace, retention: 'retain-inactive' })
    expect(second.edges).toHaveLength(1)
    expect(second.edges[0]?.evidence.map((support) => support.sourceId)).toEqual(['source-b'])

    await removeSource(records, 'source-b', ['supporters'])
    const third = await compileKnowledgeGeneration({ records, indexerId, namespace, retention: 'retain-inactive' })
    expect(third.edges).toEqual([])
    await expect(createKnowledgeGraphStore({ records, indexerId, namespace }).neighbors(documentRef('subject'), {
      types: ['supports'],
    })).resolves.toEqual([])
    await expect(pinned.neighbors(documentRef('subject'), { types: ['supports'] })).resolves.toHaveLength(1)
  })

  it('normalizes symmetric edge identity and writes adjacency from both endpoints', async () => {
    const { records } = inMemoryStorage()
    await persistChunks(records, [chunk('left', 'l1', 'Left'), chunk('right', 'r1', 'Right')])
    const edgeId = await compileSymmetric(records, 'left', 'l1', 'right', 'r1')

    const graph = createKnowledgeGraphStore({ records, indexerId, namespace })
    await expect(graph.neighbors(chunkRef('left', 'l1'), { types: ['same-as'], direction: 'out' })).resolves.toEqual([
      { ref: chunkRef('right', 'r1'), type: 'same-as', direction: 'out' },
    ])
    await expect(graph.neighbors(chunkRef('right', 'r1'), { types: ['same-as'], direction: 'out' })).resolves.toEqual([
      { ref: chunkRef('left', 'l1'), type: 'same-as', direction: 'out' },
    ])

    const { records: reversedRecords } = inMemoryStorage()
    await persistChunks(reversedRecords, [chunk('left', 'l1', 'Left'), chunk('right', 'r1', 'Right')])
    await expect(compileSymmetric(reversedRecords, 'right', 'r1', 'left', 'l1')).resolves.toBe(edgeId)
  })

  it('compiles direct entity refs without indexed target records', async () => {
    const { records } = inMemoryStorage()
    await persistChunks(records, [chunk('alpha', 'a1', 'Alpha mentions Crux')])
    const stage = relate({
      id: 'entities',
      version: 1,
      types: { mentions: relation(['chunk'], ['entity'], 'directed') },
      run: (_input, api) => api.emit(
        'mentions',
        chunkRef('alpha', 'a1'),
        entityRef('crux'),
        { evidence: chunkRef('alpha', 'a1'), provenance: 'exact' },
      ),
    })
    await runDeriveStages({ records, indexerId, namespace, stages: [stage], document: document('alpha'), chunks: [
      chunk('alpha', 'a1', 'Alpha mentions Crux'),
    ] })

    const result = await compileKnowledgeGeneration({ records, indexerId, namespace, retention: 'retain-inactive' })
    expect(result.edges[0]).toMatchObject({ to: entityRef('crux') })
    expect(result.entities).toEqual([expect.objectContaining({ entityId: 'crux' })])
  })

})

async function compileSymmetric(
  records: RecordStore,
  fromSourceId: string,
  fromChunkId: string,
  toSourceId: string,
  toChunkId: string,
): Promise<string> {
  const stage = relate({
    id: 'same-stage',
    version: 1,
    types: { 'same-as': relation(['chunk'], ['chunk'], 'symmetric') },
    run: (_input, api) => {
      const from = chunkRef(fromSourceId, fromChunkId)
      api.emit('same-as', from, chunkRef(toSourceId, toChunkId), { evidence: from, provenance: 'exact' })
    },
  })
  await runDeriveStages({
    records,
    indexerId,
    namespace,
    stages: [stage],
    document: document(fromSourceId),
    chunks: [chunk(fromSourceId, fromChunkId, 'same')],
  })
  const result = await compileKnowledgeGeneration({ records, indexerId, namespace, retention: 'retain-inactive' })
  return result.edges[0]?.edgeId ?? ''
}

async function persistChunks(records: RecordStore, chunks: readonly CruxChunk[]): Promise<void> {
  await createIndexedKnowledgeStore({ records, indexerId, namespace }).persistGeneration({
    chunks,
    parents: [],
    replaceSources: true,
    now: 1,
  })
}

async function removeSource(records: RecordStore, sourceId: string, stageIds: readonly string[]): Promise<void> {
  await createIndexedKnowledgeStore({ records, indexerId, namespace }).deleteSource(sourceId)
  await deleteKnowledgeClaimsForSource({ records, indexerId, namespace, sourceId, stageIds })
}

async function pendingStatuses(records: RecordStore, stageId: string, sourceId: string): Promise<readonly unknown[]> {
  const entries = await records.list(knowledgeClaimsKey(indexerId, namespace, stageId, sourceId, ''))
  return entries.entries.map((entry) => entry.value.status)
}

function relation(
  from: readonly ['chunk'] | readonly ['document'],
  to: readonly ['document'] | readonly ['chunk'] | readonly ['entity'],
  direction: 'directed' | 'symmetric',
) {
  return { from, to, direction, description: `${direction} relation` }
}

function document(sourceId: string): CruxDocument {
  return { namespace, sourceId, content: sourceId }
}

function chunk(
  sourceId: string,
  chunkId: string,
  content: string,
  metadata: Record<string, unknown> = {},
): CruxChunk {
  return schema2TextChunk({
    namespace,
    sourceId,
    chunkId,
    ordinal: 0,
    content,
    metadata,
  })
}

function documentRef(sourceId: string): KnowledgeRef {
  return { kind: 'document', sourceId }
}

function chunkRef(sourceId: string, chunkId: string): KnowledgeRef {
  return { kind: 'chunk', sourceId, chunkId }
}

function entityRef(entityId: string): KnowledgeRef {
  return { kind: 'entity', entityId }
}
