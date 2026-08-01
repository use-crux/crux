import { describe, expect, it, vi } from 'vitest'
import { embedding } from '../../src/embedding'
import { createIndexedKnowledgeStore } from '../../src/indexed-knowledge'
import { createStableId } from '../../src/indexing/hash'
import { indexingPipeline, type CruxChunk, type CruxDocument } from '../../src/indexing'
import { compileKnowledgeGeneration } from '../../src/knowledge/compile'
import { runDeriveStages } from '../../src/knowledge/derive/runner'
import { createKnowledgeGenerationStore } from '../../src/knowledge/generation'
import { createKnowledgeGraphStore } from '../../src/knowledge/graph-store'
import { knowledgeClaimsKey } from '../../src/knowledge/keys'
import type { KnowledgeModel } from '../../src/knowledge/model'
import { asKnowledgeEdgeRecord } from '../../src/knowledge/records'
import { relateEntities, relateReferences } from '../../src/knowledge'
import type { KnowledgeRef } from '../../src/knowledge/refs'
import { knowledgeBase } from '../../src/retrieval'
import { inMemoryStorage, type RecordStore } from '../../src/storage'
import { textOf } from '../embedding/text-input'

const indexerId = 'kb'
const namespace = 'kb'

describe('built-in relation stages', () => {
  it('emits exact reference claims from explicit URL and title citations and resolves pending URLs later', async () => {
    const storage = inMemoryStorage()
    const docs = knowledgeBase({
      id: indexerId,
      storage,
      embeddings: topicEmbedding(),
      pipeline: indexingPipeline({ derive: [relateReferences()] }),
      lifecycle: { retention: 'retain-inactive' },
    })
    const alpha = document(
      'alpha',
      'Alpha cites [Beta](https://example.test/beta), "Beta Title" [1], and https://example.test/missing.',
      'Alpha Title',
    )
    const beta = document('beta', 'Beta source text.', 'Beta Title', 'https://example.test/beta')
    const missing = document('missing', 'Missing source text.', 'Missing Title', 'https://example.test/missing')

    await docs.index([alpha, beta])

    const firstEdges = await edgeRecords(storage.records)
    expect(firstEdges).toHaveLength(1)
    expect(firstEdges[0]).toMatchObject({
      type: 'references',
      from: { kind: 'chunk', sourceId: 'alpha' },
      to: { kind: 'document', sourceId: 'beta' },
      evidence: [expect.objectContaining({ sourceId: 'alpha', provenance: 'exact' })],
    })
    await expect(pendingStatuses(storage.records, 'references', 'alpha')).resolves.toEqual(['pending', 'ready', 'ready'])

    await docs.reindex([alpha, beta, missing])

    const secondEdges = await edgeRecords(storage.records)
    expect(secondEdges.map((edge) => [refSourceId(edge.from), refSourceId(edge.to)])).toEqual([
      ['alpha', 'beta'],
      ['alpha', 'missing'],
    ])
    expect(secondEdges.flatMap((edge) => edge.evidence.map((support) => support.provenance))).toEqual(['exact', 'exact'])
    await expect(pendingStatuses(storage.records, 'references', 'alpha')).resolves.toEqual(['ready', 'ready', 'ready'])
  })

  it('extracts generic entity mentions and related pairs with cached model calls', async () => {
    const { records } = inMemoryStorage()
    await persistChunks(records, [
      chunk('alpha', 'a1', 'Crux indexes connected knowledge.'),
      chunk('alpha', 'a2', 'CRUX relates knowledge to TypeScript.'),
    ])
    const source = model({
      mentions: [
        { chunkId: 'a1', name: 'Crux' },
        { chunkId: 'a2', name: ' CRUX ' },
      ],
      related: [
        { from: 'TypeScript', to: 'Crux', description: 'Used together in the source text', chunkIds: ['a2'] },
      ],
    })
    const stage = relateEntities({ model: source, instructions: 'Prefer product and language names.' })
    const args = {
      records,
      indexerId,
      namespace,
      stages: [stage],
      document: document('alpha', 'Crux indexes connected knowledge.\nCRUX relates knowledge to TypeScript.'),
      chunks: [
        chunk('alpha', 'a1', 'Crux indexes connected knowledge.'),
        chunk('alpha', 'a2', 'CRUX relates knowledge to TypeScript.'),
      ],
    }

    const firstRun = await runDeriveStages(args)
    expect(firstRun).toEqual([{ stageId: 'entities', status: 'ran', claims: 3, warnings: [] }])
    expect(source.generateObject).toHaveBeenCalledTimes(1)

    const compiled = await compileKnowledgeGeneration({ records, indexerId, namespace, retention: 'retain-inactive' })
    const crux = entityRef('crux')
    const typescript = entityRef('typescript')
    const mentionEdges = compiled.edges.filter((edge) => edge.type === 'mentions')
    const relatedEdge = compiled.edges.find((edge) => edge.type === 'related')

    expect(compiled.entities.map((entity) => entity.entityId).sort()).toEqual([
      crux.entityId,
      typescript.entityId,
    ].sort())
    expect(mentionEdges.map((edge) => edge.to)).toEqual([crux, crux])
    expect(mentionEdges.map((edge) => edge.from)).toEqual([
      chunkRef('alpha', 'a1'),
      chunkRef('alpha', 'a2'),
    ])
    expect(mentionEdges.flatMap((edge) => edge.evidence.map((support) => support.provenance))).toEqual([
      'derived',
      'derived',
    ])
    expect(relatedEdge).toMatchObject({
      type: 'related',
      direction: 'symmetric',
      description: 'Used together in the source text',
      evidence: [expect.objectContaining({ chunkRef: chunkRef('alpha', 'a2'), provenance: 'derived' })],
    })
    expect([relatedEdge?.from, relatedEdge?.to]).toEqual(
      [crux, typescript].sort((left, right) => encodeRef(left).localeCompare(encodeRef(right))),
    )

    const graph = createKnowledgeGraphStore({ records, indexerId, namespace })
    await expect(graph.neighbors(crux, { types: ['related'], direction: 'out' })).resolves.toEqual([
      { ref: typescript, type: 'related', direction: 'out' },
    ])
    await expect(graph.neighbors(typescript, { types: ['related'], direction: 'out' })).resolves.toEqual([
      { ref: crux, type: 'related', direction: 'out' },
    ])

    await expect(runDeriveStages(args)).resolves.toEqual([
      { stageId: 'entities', status: 'cached', claims: 3, warnings: [] },
    ])
    expect(source.generateObject).toHaveBeenCalledTimes(1)
  })

  it('rejects missing entity model configuration for JavaScript callers', () => {
    expect(() => relateEntities(undefined as never)).toThrow(/knowledge model/)
    expect(() => relateEntities({} as never)).toThrow(/knowledge model/)
  })
})

async function edgeRecords(records: RecordStore) {
  const generationId = await createKnowledgeGenerationStore({ records, indexerId, namespace }).currentGeneration()
  const entries = await records.list('')
  return entries.entries
    .flatMap((entry) => {
      const edge = asKnowledgeEdgeRecord(entry.value)
      return edge && edge.generationId === generationId ? [edge] : []
    })
    .sort((left, right) => left.edgeId.localeCompare(right.edgeId))
}

async function persistChunks(records: RecordStore, chunks: readonly CruxChunk[]): Promise<void> {
  await createIndexedKnowledgeStore({ records, indexerId, namespace }).persistGeneration({
    chunks,
    parents: [],
    replaceSources: true,
    now: 1,
  })
}

async function pendingStatuses(records: RecordStore, stageId: string, sourceId: string): Promise<readonly unknown[]> {
  const entries = await records.list(knowledgeClaimsKey(indexerId, namespace, stageId, sourceId, ''))
  return entries.entries
    .filter((entry) => entry.value._cruxRecordType === 'knowledge-claim')
    .map((entry) => entry.value.status)
    .sort()
}

function document(sourceId: string, content: string, title = sourceId, url?: string): CruxDocument {
  return {
    namespace,
    sourceId,
    content,
    title,
    metadata: { title },
    ...(url ? { source: { url } } : {}),
  }
}

function chunk(sourceId: string, chunkId: string, content: string): CruxChunk {
  return { namespace, sourceId, chunkId, ordinal: Number(chunkId.slice(1)) || 0, content, metadata: {} }
}

function chunkRef(sourceId: string, chunkId: string): KnowledgeRef {
  return { kind: 'chunk', sourceId, chunkId }
}

function entityRef(name: string): KnowledgeRef {
  return { kind: 'entity', entityId: createStableId('entity', name.trim().toLowerCase().replace(/\s+/g, ' ')) }
}

function model(object: unknown): KnowledgeModel {
  return {
    name: 'entity-extractor',
    fingerprint: 'entity-fp',
    generateText: async () => ({ text: '', usage: undefined, response: undefined }) as never,
    generateObject: vi.fn(async () => ({ object })),
  }
}

function topicEmbedding() {
  return embedding({
    kind: 'dense',
    name: 'topic',
    dimensions: 2,
    maxInputTokens: 100,
    batch: { maxSize: 8 },
    embed: async (inputs) => inputs.map((input) => textOf(input).includes('Alpha') ? [1, 0] : [0, 1]),
  })
}

function encodeRef(ref: KnowledgeRef | undefined): string {
  if (!ref) return ''
  if (ref.kind === 'chunk') return `chunk:${ref.sourceId}:${ref.chunkId}`
  if (ref.kind === 'document') return `document:${ref.sourceId}`
  if (ref.kind === 'parent') return `parent:${ref.sourceId}:${ref.parentId}`
  return `entity:${ref.entityId}`
}

function refSourceId(ref: KnowledgeRef): string | undefined {
  return ref.kind === 'entity' ? undefined : ref.sourceId
}
