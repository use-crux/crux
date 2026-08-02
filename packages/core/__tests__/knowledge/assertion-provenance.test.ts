import { describe, expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { createIndexedKnowledgeStore } from '../../src/indexed-knowledge'
import { indexingPipeline, type CruxChunk } from '../../src/indexing'
import { createKnowledgeGenerationStore, type KnowledgeGenerationWriter } from '../../src/knowledge/generation'
import { createKnowledgeGraphStore } from '../../src/knowledge/graph-store'
import {
  assertions,
  knowledgeBase,
  type AssertionDecisionEvidence,
  type AssertionListPage,
  type AssertionRelationRecord,
  type KnowledgeGraphReader,
  type KnowledgeNeighbor,
} from '../../src/knowledge'
import { knowledgeAdjacencyOutKey } from '../../src/knowledge/keys'
import { createKnowledgeEdgeRecord, type KnowledgeEdgeRecord } from '../../src/knowledge/records'
import type { KnowledgeRef } from '../../src/knowledge/refs'
import { inMemoryStorage, type JsonObject, type RecordStore } from '../../src/storage'

const indexerId = 'docs'
const namespace = 'docs'

const types = {
  fact: z.object({ id: z.string(), text: z.string() }).describe('A fact'),
}

describe('assertion provenance read surfaces', () => {
  it('paginates and filters visible full assertion relation records', async () => {
    const storage = inMemoryStorage()
    const stage = assertionStage()
    const docs = knowledgeBase({
      id: indexerId,
      storage,
      metadataSchema: z.object({ status: z.enum(['open', 'closed']) }),
      pipeline: indexingPipeline({ derive: [stage] }),
    })
    await docs.index([
      chunk('open-source', 'open relations', { status: 'open' }),
      chunk('closed-source', 'closed relation', { status: 'closed' }),
    ])

    const first = await docs.assertions(stage).relations({ types: ['supersedes'], limit: 1 })
    const second = await docs.assertions(stage).relations({ types: ['supersedes'], cursor: first.cursor })
    const corpusClosed = await docs.assertions(stage).relations({ types: ['narrows'] })
    const viewClosed = await docs.view({ id: 'open', where: { status: 'open' } })
      .assertions(stage)
      .relations({ types: ['narrows'] })

    expect(first.items).toHaveLength(1)
    expect(first.cursor).toBeTypeOf('string')
    expect(second.items).toHaveLength(1)
    expect([...first.items, ...second.items].map((relation) => relation.type)).toEqual(['supersedes', 'supersedes'])
    expect(corpusClosed.items).toHaveLength(1)
    expect(viewClosed.items).toEqual([])
    expect(first.items[0]).toMatchObject({
      _cruxRecordType: 'knowledge-assertion-relation',
      type: 'supersedes',
      from: { assertionId: expect.any(String) },
      to: { assertionId: expect.any(String) },
      evidence: [{ sourceId: 'open-source', chunkRef: chunkRef('open-source', 'main'), provenance: 'exact' }],
      provenance: 'exact',
      stageId: 'facts',
      stageVersion: 1,
      generationId: expect.any(String),
      namespace,
      direction: 'directed',
      createdAt: expect.any(Number),
      updatedAt: expect.any(Number),
    })
    expect(first.items[0]?.stageFingerprint).toEqual(expect.any(String))
  })

  it('carries relation refs and provenance in resolution traces without content', async () => {
    const storage = inMemoryStorage()
    const stage = assertionStage()
    const docs = knowledgeBase({ id: indexerId, storage, pipeline: indexingPipeline({ derive: [stage] }) })
    await docs.index([chunk('open-source', 'open relations')])

    const result = await docs.assertions(stage).resolve().result()
    const traceEvidence = result.trace.flatMap((trace) => trace.evidence)
    const relation = traceEvidence.find((entry): entry is Extract<AssertionDecisionEvidence, { readonly kind: 'relation' }> =>
      entry.kind === 'relation' && entry.type === 'supersedes',
    )

    expect(relation).toMatchObject({
      kind: 'relation',
      relationId: expect.any(String),
      type: 'supersedes',
      evidence: [{ sourceId: 'open-source', chunkRef: chunkRef('open-source', 'main'), provenance: 'exact' }],
      provenance: 'exact',
      stageId: 'facts',
      stageVersion: 1,
      stageFingerprint: expect.any(String),
    })
    expect(relation).not.toHaveProperty('data')
    expect(relation?.evidence[0]).not.toHaveProperty('content')
  })

  it('includes graph evidence only when requested', async () => {
    const { records } = inMemoryStorage()
    await createIndexedKnowledgeStore({ records, indexerId, namespace }).persistGeneration({
      chunks: [indexedChunk('guide', 'intro')],
      parents: [],
      replaceSources: true,
      now: 1,
    })
    await publishEdge(records, semanticEdge('gen-1'))
    const graph = createKnowledgeGraphStore({ records, indexerId, namespace })

    await expect(graph.neighbors(documentRef('guide'))).resolves.toEqual([
      { ref: chunkRef('guide', 'intro'), type: 'hierarchy', direction: 'out' },
      { ref: entityRef('crux'), type: 'mentions', direction: 'out' },
    ])
    await expect(graph.neighbors(documentRef('guide'), { includeEvidence: true })).resolves.toEqual([
      { ref: chunkRef('guide', 'intro'), type: 'hierarchy', direction: 'out', evidence: [] },
      {
        ref: entityRef('crux'),
        type: 'mentions',
        direction: 'out',
        evidence: [{ sourceId: 'guide', chunkRef: chunkRef('guide', 'intro'), provenance: 'exact' }],
      },
    ])
    expect(await graph.neighbors(documentRef('guide'))).toSatisfy((neighbors: KnowledgeNeighbor[]) =>
      neighbors.every((neighbor) => !Object.hasOwn(neighbor, 'evidence')),
    )
  })

  it('types the new relation and graph read surfaces', () => {
    const docs = knowledgeBase({ id: 'typed' })
    const set = docs.assertions(assertionStage(), { types: ['fact'] as const })
    expectTypeOf<ReturnType<typeof set.relations>>()
      .toEqualTypeOf<Promise<AssertionListPage<AssertionRelationRecord>>>()
    expectTypeOf<Extract<AssertionDecisionEvidence, { readonly kind: 'relation' }>['evidence'][number]['chunkRef']['kind']>()
      .toEqualTypeOf<'chunk'>()
    expectTypeOf<ReturnType<KnowledgeGraphReader['neighbors']>>()
      .toEqualTypeOf<Promise<KnowledgeNeighbor[]>>()
    expectTypeOf<Parameters<KnowledgeGraphReader['neighbors']>[1]>()
      .toMatchTypeOf<{ readonly includeEvidence?: boolean } | undefined>()
    if (false) {
      // @ts-expect-error Assertion relation read filters use the closed relation vocabulary.
      set.relations({ types: ['replaces'] })
    }
  })
})

function assertionStage() {
  return assertions({
    id: 'facts',
    version: 1,
    types,
    run: (input, api) => {
      const evidence = chunkRef(input.document.sourceId, input.chunks[0]?.chunkId ?? 'main')
      const opts = { evidence, provenance: 'exact' as const }
      if (input.document.content === 'closed relation') {
        api.relate('narrows',
          api.emit('fact', { id: 'closed-a', text: 'closed a' }, opts),
          api.emit('fact', { id: 'closed-b', text: 'closed b' }, opts),
          opts)
        return
      }
      api.relate('supersedes',
        api.emit('fact', { id: 'new-a', text: 'new a' }, opts),
        api.emit('fact', { id: 'old-a', text: 'old a' }, opts),
        opts)
      api.relate('supersedes',
        api.emit('fact', { id: 'new-b', text: 'new b' }, opts),
        api.emit('fact', { id: 'old-b', text: 'old b' }, opts),
        opts)
    },
  })
}

async function publishEdge(records: RecordStore, record: KnowledgeEdgeRecord): Promise<void> {
  const generations = createKnowledgeGenerationStore({ records, indexerId, namespace, retention: 'retain-inactive' })
  const writer = generations.beginGeneration(record.generationId)
  await writeEdge(writer, record)
  await writer.finish()
  await generations.publish(record.generationId)
}

async function writeEdge(writer: KnowledgeGenerationWriter, record: KnowledgeEdgeRecord): Promise<void> {
  await writer.putEdge(record)
  await writer.putRecord(
    knowledgeAdjacencyOutKey(indexerId, namespace, record.generationId, record.from, record.type, record.edgeId),
    { edgeId: record.edgeId, type: record.type, peerRef: record.to } as unknown as JsonObject,
  )
}

function semanticEdge(generationId: string): KnowledgeEdgeRecord {
  return createKnowledgeEdgeRecord({
    type: 'mentions',
    from: documentRef('guide'),
    to: entityRef('crux'),
    direction: 'directed',
    evidence: [{ sourceId: 'guide', chunkRef: chunkRef('guide', 'intro'), provenance: 'exact' }],
    stageId: 'semantic',
    stageVersion: 1,
    generationId,
    namespace,
    now: 1,
  })
}

function chunk(sourceId: string, content: string, metadata: Record<string, unknown> = {}): CruxChunk {
  return { namespace, sourceId, chunkId: 'main', ordinal: 0, content, metadata }
}

function indexedChunk(sourceId: string, chunkId: string): CruxChunk {
  return { namespace, sourceId, chunkId, ordinal: 0, content: chunkId, metadata: {} }
}

function documentRef(sourceId: string): KnowledgeRef {
  return { kind: 'document', sourceId }
}

function chunkRef(sourceId: string, chunkId: string): Extract<KnowledgeRef, { readonly kind: 'chunk' }> {
  return { kind: 'chunk', sourceId, chunkId }
}

function entityRef(entityId: string): KnowledgeRef {
  return { kind: 'entity', entityId }
}
