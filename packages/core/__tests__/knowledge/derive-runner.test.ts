import { describe, expect, it, vi } from 'vitest'
import { stableHash } from '../../src/indexing/hash'
import type { CruxChunk, CruxDocument } from '../../src/indexing/types'
import { knowledgeClaimsKey } from '../../src/knowledge/keys'
import type { KnowledgeModel } from '../../src/knowledge/model'
import { relate } from '../../src/knowledge/relate/relate'
import { runDeriveStages } from '../../src/knowledge/derive/runner'
import type { DeriveStage } from '../../src/knowledge/derive/stage'
import { inMemoryRecordStore } from '../../src/storage'

const documentRef = { kind: 'document' as const, sourceId: 'doc-2' }
const chunkRef = { kind: 'chunk' as const, sourceId: 'doc-1', chunkId: 'c1' }

function document(content = 'Alpha cites Beta.'): CruxDocument {
  return { namespace: 'ns', sourceId: 'doc-1', title: 'Alpha', content }
}

function chunks(content = 'Alpha cites Beta.'): readonly CruxChunk[] {
  return [{
    namespace: 'ns',
    sourceId: 'doc-1',
    chunkId: 'c1',
    ordinal: 0,
    content,
    metadata: {},
  }]
}

function relation(run: Parameters<typeof relate<typeof relationTypes>>[0]['run'], version = 1) {
  return relate({ id: 'refs', version, types: relationTypes, run })
}

const relationTypes = {
  cites: {
    from: ['chunk'] as const,
    to: ['document'] as const,
    direction: 'directed' as const,
    description: 'Cites another source',
  },
}

function claimHash(provenance: 'exact' | 'derived' = 'exact') {
  return stableHash({
    type: 'cites',
    from: 'chunk:doc-1:c1',
    to: 'document:doc-2',
    evidence: ['chunk:doc-1:c1'],
    provenance,
  })
}

function model(objects: readonly unknown[]): KnowledgeModel {
  let index = 0
  return {
    name: 'extractor',
    fingerprint: 'fp',
    generateText: async () => ({ text: '', usage: undefined, response: undefined }) as never,
    generateObject: vi.fn(async () => ({ object: objects[index++] ?? objects[objects.length - 1] })),
  }
}

function withDepends(stage: DeriveStage, dependsOn: readonly string[]): DeriveStage {
  return { ...stage, dependsOn } as DeriveStage
}

describe('runDeriveStages', () => {
  it('persists deterministic claims under exact keys and caches unchanged runs', async () => {
    const records = inMemoryRecordStore()
    const run = vi.fn((_input, api) => api.emit('cites', chunkRef, documentRef, { evidence: chunkRef, provenance: 'exact' }))
    const stage = relation(run)

    const first = await runDeriveStages({
      records,
      indexerId: 'kb',
      namespace: 'ns',
      stages: [stage],
      document: document(),
      chunks: chunks(),
    })

    expect(first).toEqual([{ stageId: 'refs', status: 'ran', claims: 1, warnings: [] }])
    const hash = claimHash()
    const entries = (await records.list('')).entries.map((entry) => entry.key).sort()
    expect(entries).toEqual([
      knowledgeClaimsKey('kb', 'ns', 'refs', 'doc-1', '__manifest'),
      knowledgeClaimsKey('kb', 'ns', 'refs', 'doc-1', hash),
    ].sort())
    expect(await records.get(knowledgeClaimsKey('kb', 'ns', 'refs', 'doc-1', hash))).toMatchObject({
      stageId: 'refs',
      stageVersion: 1,
      type: 'cites',
      from: 'chunk:doc-1:c1',
      to: 'document:doc-2',
      evidence: ['chunk:doc-1:c1'],
      provenance: 'exact',
      sourceId: 'doc-1',
      claimHash: hash,
    })

    const second = await runDeriveStages({
      records,
      indexerId: 'kb',
      namespace: 'ns',
      stages: [stage],
      document: document(),
      chunks: chunks(),
    })
    expect(second).toEqual([{ stageId: 'refs', status: 'cached', claims: 1, warnings: [] }])
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('re-runs when source content or fingerprint changes and rewrites the manifest', async () => {
    const records = inMemoryRecordStore()
    const run = vi.fn((_input, api) => api.emit('cites', chunkRef, documentRef, { evidence: chunkRef }))
    const stage = relation(run)
    const args = { records, indexerId: 'kb', namespace: 'ns', stages: [stage], document: document(), chunks: chunks() }

    await runDeriveStages(args)
    const firstManifest = await records.get(knowledgeClaimsKey('kb', 'ns', 'refs', 'doc-1', '__manifest'))
    await runDeriveStages({ ...args, document: document('Changed.'), chunks: chunks('Changed.') })
    const changedSourceManifest = await records.get(knowledgeClaimsKey('kb', 'ns', 'refs', 'doc-1', '__manifest'))
    await runDeriveStages({ ...args, stages: [relation(run, 2)] })
    const changedStageManifest = await records.get(knowledgeClaimsKey('kb', 'ns', 'refs', 'doc-1', '__manifest'))

    expect(run).toHaveBeenCalledTimes(3)
    expect(changedSourceManifest?.sourceHash).not.toBe(firstManifest?.sourceHash)
    expect(changedStageManifest?.stageFingerprint).not.toBe(changedSourceManifest?.stageFingerprint)
  })

  it('rejects deterministic invalid type, endpoint kind, and missing evidence with clear errors', async () => {
    const base = { records: inMemoryRecordStore(), indexerId: 'kb', namespace: 'ns', document: document(), chunks: chunks() }
    const invalidType = relation((_input, api) => api.emit('missing' as never, chunkRef, documentRef, { evidence: chunkRef }))
    const invalidEndpoint = relation((_input, api) =>
      api.emit('cites', { kind: 'entity', entityId: 'e1' } as never, documentRef, { evidence: chunkRef }))
    const missingEvidence = relation((_input, api) => api.emit('cites', chunkRef, documentRef, undefined as never))

    await expect(runDeriveStages({ ...base, stages: [invalidType] })).rejects.toThrow(/refs type missing/)
    await expect(runDeriveStages({ ...base, stages: [invalidEndpoint] })).rejects.toThrow(/refs type cites.*from/)
    await expect(runDeriveStages({ ...base, stages: [missingEvidence] })).rejects.toThrow(/refs type cites.*evidence/)
  })

  it('repairs generated claims once, drops still-invalid claims, and keeps valid claims cached', async () => {
    const records = inMemoryRecordStore()
    const source = model([
      { claims: [
        { type: 'cites', from: chunkRef, to: documentRef, evidence: [chunkRef] },
        { type: 'missing', from: chunkRef, to: documentRef, evidence: [chunkRef] },
      ] },
      { claims: [{ type: 'missing', from: chunkRef, to: documentRef, evidence: [chunkRef] }] },
    ])
    const stage = relate({ id: 'refs', version: 1, types: relationTypes, model: source })
    const args = { records, indexerId: 'kb', namespace: 'ns', stages: [stage], document: document(), chunks: chunks() }

    const first = await runDeriveStages(args)
    expect(first[0]).toMatchObject({ status: 'ran', claims: 1 })
    expect(first[0]?.warnings).toHaveLength(1)
    expect(source.generateObject).toHaveBeenCalledTimes(2)
    expect(await records.get(knowledgeClaimsKey('kb', 'ns', 'refs', 'doc-1', claimHash('derived')))).toMatchObject({
      type: 'cites',
      provenance: 'derived',
    })

    const second = await runDeriveStages(args)
    expect(second).toEqual([{ stageId: 'refs', status: 'cached', claims: 1, warnings: first[0]?.warnings }])
    expect(source.generateObject).toHaveBeenCalledTimes(2)
  })

  it('orders dependencies and fails fast for unknown dependencies', async () => {
    const records = inMemoryRecordStore()
    const calls: string[] = []
    const a = relate({ id: 'a', version: 1, types: relationTypes, run: () => calls.push('a') })
    const b = withDepends(
      relate({ id: 'b', version: 1, types: relationTypes, run: () => calls.push('b') }),
      ['a'],
    )

    const ordered = await runDeriveStages({
      records,
      indexerId: 'kb',
      namespace: 'ns',
      stages: [b, a],
      document: document(),
      chunks: chunks(),
    })
    expect(ordered.map((result) => result.stageId)).toEqual(['a', 'b'])
    expect(calls).toEqual(['a', 'b'])

    const unknown = withDepends(b, ['missing'])
    await expect(runDeriveStages({
      records: inMemoryRecordStore(),
      indexerId: 'kb',
      namespace: 'ns',
      stages: [unknown],
      document: document(),
      chunks: chunks(),
    })).rejects.toThrow(/unknown derive missing/)
  })
})
