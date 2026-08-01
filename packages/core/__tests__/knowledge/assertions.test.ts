import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { stableHash } from '../../src/indexing/hash'
import { createIndexedKnowledgeStore } from '../../src/indexed-knowledge'
import type { CruxChunk, CruxDocument } from '../../src/indexing'
import { assertions } from '../../src/knowledge/assertions/assertions'
import { createAssertionIdentity } from '../../src/knowledge/assertions/identity'
import { compileKnowledgeGeneration, deleteKnowledgeClaimsForSource } from '../../src/knowledge/compile'
import { runDeriveStages } from '../../src/knowledge/derive/runner'
import { knowledgeAssertionsItemKey, knowledgeClaimsKey } from '../../src/knowledge/keys'
import { knowledgeModel, type KnowledgeModel } from '../../src/knowledge/model'
import { inMemoryStorage, type RecordStore } from '../../src/storage'

const indexerId = 'kb'
const namespace = 'ns'
const chunkRef = { kind: 'chunk' as const, sourceId: 'doc-1', chunkId: 'c1' }

const schemas = {
  fact: z.object({ value: z.string() }).describe('A named fact'),
  price: z.object({ amount: z.number(), currency: z.string() }).describe('A quoted price'),
}

function retrievalModel(): KnowledgeModel {
  return knowledgeModel({
    name: 'assertion-extractor',
    version: '1',
    generateText: async () => ({ text: '', usage: undefined, response: undefined }) as never,
    generateObject: async () => ({ object: {} }) as never,
  })
}

describe('assertions', () => {
  it('returns inert assertion configuration and rejects invalid configs', () => {
    const stage = assertions({ id: 'facts', version: 1, types: schemas, run: () => {} })

    expect(stage).toMatchObject({
      _tag: 'AssertionStage',
      kind: 'assertion',
      id: 'facts',
      version: 1,
      mode: 'run',
    })
    expect(Object.isFrozen(stage)).toBe(true)
    expect(stage.fingerprint()).toEqual(expect.any(String))

    expect(() => assertions({ id: '', version: 1, types: schemas, run: () => {} })).toThrow(/id/)
    expect(() => assertions({ id: 'facts', version: 0, types: schemas, run: () => {} })).toThrow(/version/)
    expect(() => assertions({ id: 'facts', version: 1, types: {}, run: () => {} })).toThrow(/at least one/)
    expect(() => assertions({
      id: 'facts',
      version: 1,
      types: { 'bad:name': z.object({ value: z.string() }) },
      run: () => {},
    })).toThrow(/must not contain/)
    expect(() => assertions({ id: 'facts', version: 1, types: schemas } as never)).toThrow(/exactly one/)
    expect(() => assertions({
      id: 'facts',
      version: 1,
      types: schemas,
      model: retrievalModel(),
      run: () => {},
    } as never)).toThrow(/exactly one/)
  })

  it('changes fingerprints when schema descriptions change', () => {
    const first = assertions({ id: 'facts', version: 1, types: schemas, run: () => {} })
    const changed = assertions({
      id: 'facts',
      version: 1,
      types: {
        ...schemas,
        fact: z.object({ value: z.string() }).describe('A renamed fact'),
      },
      run: () => {},
    })

    expect(first.fingerprint()).not.toBe(changed.fingerprint())
  })

  it('persists deterministic assertions under exact claim and generation keys', async () => {
    const { records } = inMemoryStorage()
    await persistChunks(records, [chunk('doc-1', 'c1', 'Price is 12 EUR')])
    const stage = assertions({
      id: 'facts',
      version: 1,
      types: schemas,
      run: (_input, api) => {
        api.emit('price', { currency: 'EUR', amount: 12 }, { evidence: chunkRef, provenance: 'exact' })
      },
    })

    await runDeriveStages({ records, indexerId, namespace, stages: [stage], document: document('doc-1'), chunks: [
      chunk('doc-1', 'c1', 'Price is 12 EUR'),
    ] })
    const hash = stableHash({
      type: 'price',
      data: { amount: 12, currency: 'EUR' },
      evidence: ['chunk:doc-1:c1'],
      provenance: 'exact',
    })
    expect(await records.get(knowledgeClaimsKey(indexerId, namespace, 'facts', 'doc-1', hash))).toMatchObject({
      _cruxRecordType: 'knowledge-assertion-claim',
      stageId: 'facts',
      type: 'price',
      data: { amount: 12, currency: 'EUR' },
      evidence: ['chunk:doc-1:c1'],
    })

    const compiled = await compileKnowledgeGeneration({ records, indexerId, namespace, retention: 'retain-inactive' })
    const assertionId = createAssertionIdentity({
      stageId: 'facts',
      stageVersion: 1,
      stageFingerprint: stage.fingerprint(),
      type: 'price',
      data: { amount: 12, currency: 'EUR' },
    })
    const key = knowledgeAssertionsItemKey(indexerId, namespace, 'facts', compiled.generationId, assertionId)
    expect(await records.get(key)).toMatchObject({
      _cruxRecordType: 'knowledge-assertion',
      assertionId,
      type: 'price',
      evidence: [{ sourceId: 'doc-1', chunkRef }],
    })
  })

  it('merges identical proposition supports and GCs unsupported assertions on compile', async () => {
    const { records } = inMemoryStorage()
    await persistChunks(records, [chunk('source-a', 'a1', 'A'), chunk('source-b', 'b1', 'B')])
    const stage = assertions({
      id: 'facts',
      version: 1,
      types: schemas,
      run: (input, api) => {
        const evidence = { kind: 'chunk' as const, sourceId: input.document.sourceId, chunkId: input.chunks[0]?.chunkId ?? '' }
        api.emit('fact', { value: 'same' }, { evidence, provenance: 'exact' })
      },
    })

    for (const sourceId of ['source-a', 'source-b']) {
      await runDeriveStages({
        records,
        indexerId,
        namespace,
        stages: [stage],
        document: document(sourceId),
        chunks: [chunk(sourceId, sourceId === 'source-a' ? 'a1' : 'b1', sourceId)],
      })
    }

    const first = await compileKnowledgeGeneration({ records, indexerId, namespace, retention: 'retain-inactive' })
    expect(first.assertions).toHaveLength(1)
    expect(first.assertions[0]?.evidence.map((support) => support.sourceId)).toEqual(['source-a', 'source-b'])

    await removeSource(records, 'source-a', ['facts'])
    const second = await compileKnowledgeGeneration({ records, indexerId, namespace, retention: 'retain-inactive' })
    expect(second.assertions).toHaveLength(1)
    expect(second.assertions[0]?.evidence.map((support) => support.sourceId)).toEqual(['source-b'])

    await removeSource(records, 'source-b', ['facts'])
    const third = await compileKnowledgeGeneration({ records, indexerId, namespace, retention: 'retain-inactive' })
    expect(third.assertions).toEqual([])
    expect((await records.list(`indexer:${indexerId}:namespace:${namespace}:assertions:`)).entries).toEqual([])
  })

  it('repairs generated assertions once, drops invalid outputs, and caches valid claims', async () => {
    const { records } = inMemoryStorage()
    await persistChunks(records, [chunk('doc-1', 'c1', 'Fact')])
    const model = countingModel([
      { assertions: [
        { type: 'fact', data: { value: 'valid' }, evidence: [chunkRef] },
        { type: 'fact', data: { value: 12 }, evidence: [chunkRef] },
        { type: 'fact', data: { value: 'missing evidence' } },
      ] },
      { assertions: [
        { type: 'fact', data: { value: 12 }, evidence: [chunkRef] },
        { type: 'fact', data: { value: 'missing evidence' } },
      ] },
    ])
    const stage = assertions({ id: 'facts', version: 1, types: schemas, model })
    const args = { records, indexerId, namespace, stages: [stage], document: document('doc-1'), chunks: [
      chunk('doc-1', 'c1', 'Fact'),
    ] }

    const first = await runDeriveStages(args)
    expect(first[0]).toMatchObject({ status: 'ran', claims: 1 })
    expect(first[0]?.warnings).toHaveLength(2)
    expect(model.generateObject).toHaveBeenCalledTimes(2)

    const compiled = await compileKnowledgeGeneration({ records, indexerId, namespace, retention: 'retain-inactive' })
    expect(compiled.assertions).toHaveLength(1)
    expect(compiled.assertions[0]).toMatchObject({ type: 'fact', data: { value: 'valid' } })

    const second = await runDeriveStages(args)
    expect(second).toEqual([{ stageId: 'facts', status: 'cached', claims: 1, warnings: [] }])
    expect(model.generateObject).toHaveBeenCalledTimes(2)
  })
})

function countingModel(objects: readonly unknown[]): KnowledgeModel {
  let index = 0
  return {
    name: 'assertion-extractor',
    fingerprint: 'fp',
    generateText: async () => ({ text: '', usage: undefined, response: undefined }) as never,
    generateObject: vi.fn(async () => ({ object: objects[index++] ?? objects[objects.length - 1] })),
  }
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

function document(sourceId: string): CruxDocument {
  return { namespace, sourceId, content: sourceId }
}

function chunk(sourceId: string, chunkId: string, content: string): CruxChunk {
  return { namespace, sourceId, chunkId, ordinal: 0, content, metadata: {} }
}
