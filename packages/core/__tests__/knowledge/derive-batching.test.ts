import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { ValidationExhaustedError } from '../../src/generation/validation-retry'
import type { CruxChunk, CruxDocument } from '../../src/indexing/types'
import { assertions, knowledgeModel, relate, type KnowledgeContentPart, type KnowledgeModel } from '../../src/knowledge'
import { MAX_DERIVE_BATCH_CHARS, EXTRACTION_CONTRACT_VERSION } from '../../src/knowledge/derive/bounds'
import { claimManifestKey, readClaimManifest } from '../../src/knowledge/derive/manifest'
import { runDeriveStages } from '../../src/knowledge/derive/runner'
import { inMemoryAssetStore, inMemoryRecordStore } from '../../src/storage'

const namespace = 'derive-batch'
const sourceId = 'doc-1'
const relationTypes = {
  mentions: {
    from: ['chunk'] as const,
    to: ['entity'] as const,
    direction: 'directed' as const,
    description: 'A chunk mentions an entity',
  },
}
const assertionTypes = {
  fact: z.object({ value: z.string() }),
}

describe('connected knowledge derive batching', () => {
  it('extracts relation claims from every deterministic batch, including the last chunk', async () => {
    const prompts: string[] = []
    const model = relationModel(prompts)
    const stage = relate({ id: 'refs', version: 1, types: relationTypes, model })
    const sourceChunks = Array.from({ length: 5 }, (_, index) =>
      chunk(`c${index + 1}`, index, sizedContent(5000, index === 4 ? 'LAST_CHUNK_MARKER' : `chunk-${index + 1}`)))

    const result = await runDeriveStages({
      records: inMemoryRecordStore(),
      indexerId: 'kb',
      namespace,
      stages: [stage],
      document: document('relation coverage'),
      chunks: sourceChunks,
    })

    const expectedCalls = Math.ceil(sourceChunks.reduce((sum, item) => sum + item.content.length, 0) / MAX_DERIVE_BATCH_CHARS)
    expect(model.generateObject).toHaveBeenCalledTimes(expectedCalls)
    expect(result).toEqual([{ stageId: 'refs', status: 'ran', claims: 5, warnings: [] }])
    expect(prompts.some((prompt) => prompt.includes('LAST_CHUNK_MARKER'))).toBe(true)
  })

  it('continues filling a batch after a mixed-size chunk overflows the previous batch', async () => {
    const prompts: string[] = []
    const model = relationModel(prompts)
    const stage = relate({ id: 'refs', version: 1, types: relationTypes, model })
    const sourceChunks = [5000, 5000, 3800, 3800, 3800].map((size, index) =>
      chunk(`c${index + 1}`, index, sizedContent(size, `chunk-${index + 1}`)))

    await runDeriveStages({
      records: inMemoryRecordStore(),
      indexerId: 'kb',
      namespace,
      stages: [stage],
      document: document('mixed-size batches'),
      chunks: sourceChunks,
    })

    expect(model.generateObject).toHaveBeenCalledTimes(2)
    expect(prompts.map(chunkIdsFromPrompt)).toEqual([
      ['c1', 'c2'],
      ['c3', 'c4', 'c5'],
    ])
  })

  it('uses ordinal ordering for deterministic batches and manifest identity', async () => {
    const ordered = [
      chunk('c1', 0, sizedContent(5000, 'one')),
      chunk('c2', 1, sizedContent(5000, 'two')),
      chunk('c3', 2, sizedContent(5000, 'three')),
    ]
    const first = await runRelationWithPrompts(ordered)
    const second = await runRelationWithPrompts([ordered[2]!, ordered[0]!, ordered[1]!])

    expect(second.prompts).toEqual(first.prompts)
    expect(second.manifest).toEqual(first.manifest)
  })

  it('batches model-backed assertions and unions claims across batches', async () => {
    const prompts: string[] = []
    const model = assertionModel(prompts)
    const stage = assertions({ id: 'facts', version: 1, types: assertionTypes, model })
    const sourceChunks = Array.from({ length: 5 }, (_, index) =>
      chunk(`c${index + 1}`, index, sizedContent(5000, `assertion-${index + 1}`)))

    const result = await runDeriveStages({
      records: inMemoryRecordStore(),
      indexerId: 'kb',
      namespace,
      stages: [stage],
      document: document('assertion coverage'),
      chunks: sourceChunks,
    })

    expect(model.generateObject).toHaveBeenCalledTimes(3)
    expect(result).toEqual([{ stageId: 'facts', status: 'ran', claims: 5, warnings: [] }])
    expect(prompts.flatMap(chunkIdsFromPrompt)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5'])
  })

  it('leaves the prior manifest intact when a batch still fails after repair', async () => {
    const records = inMemoryRecordStore()
    const good = relate({ id: 'refs', version: 1, types: relationTypes, model: relationModel() })
    const badModel = fixedRelationModel([
      { claims: [{ type: 'missing', from: chunkRef('c1'), to: { kind: 'entity', entityId: 'bad' }, evidence: [chunkRef('c1')] }] },
      { claims: [{ type: 'missing', from: chunkRef('c1'), to: { kind: 'entity', entityId: 'bad' }, evidence: [chunkRef('c1')] }] },
    ])
    const changed = relate({ id: 'refs', version: 2, types: relationTypes, model: badModel })
    const chunks = [chunk('c1', 0, 'alpha')]
    const key = manifestKey('refs')

    await runDeriveStages({ records, indexerId: 'kb', namespace, stages: [good], document: document(), chunks })
    const prior = await records.get(key)

    await expect(runDeriveStages({
      records,
      indexerId: 'kb',
      namespace,
      stages: [changed],
      document: document(),
      chunks,
    })).rejects.toThrow(/unknown type/)

    expect(badModel.generateObject).toHaveBeenCalledTimes(2)
    expect(await records.get(key)).toEqual(prior)
  })

  it('reports every relation validation error when repair fails', async () => {
    const invalid = {
      claims: ['missing-one', 'missing-two'].map((type) => ({
        type,
        from: chunkRef('c1'),
        to: { kind: 'entity', entityId: type },
        evidence: [chunkRef('c1')],
      })),
    }
    const stage = relate({ id: 'refs', version: 1, types: relationTypes, model: fixedRelationModel([invalid, invalid]) })

    await expect(runDeriveStages({
      records: inMemoryRecordStore(),
      indexerId: 'kb',
      namespace,
      stages: [stage],
      document: document(),
      chunks: [chunk('c1', 0, 'alpha')],
    })).rejects.toThrow(/Derive refs type missing-one: unknown type\nDerive refs type missing-two: unknown type/)
  })

  it('reports typed assertion validation exhaustion with every failed output item', async () => {
    const types = {
      first: z.object({ value: z.string() }),
      second: z.object({ value: z.string() }),
    }
    const invalid = {
      assertions: [
        { type: 'first', data: { value: 1 }, evidence: [chunkRef('c1')] },
        { type: 'second', data: { value: 2 }, evidence: [chunkRef('c1')] },
      ],
    }
    const model = fixedAssertionModel([invalid, invalid])
    const stage = assertions({ id: 'facts', version: 1, types, model })

    const error = await runDeriveStages({
      records: inMemoryRecordStore(),
      indexerId: 'kb',
      namespace,
      stages: [stage],
      document: document(),
      chunks: [chunk('c1', 0, 'alpha')],
    }).catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(ValidationExhaustedError)
    expect(error).toMatchObject({ attempts: 1, maxAttempts: 1, promptId: 'facts' })
    expect((error as ValidationExhaustedError).issues).toHaveLength(2)
  })

  it('truncates only an oversized single chunk and leaves surrounding batches intact', async () => {
    const prompts: string[] = []
    const model = relationModel(prompts)
    const stage = relate({ id: 'refs', version: 1, types: relationTypes, model })
    const huge = `HUGE_START ${'x'.repeat(MAX_DERIVE_BATCH_CHARS + 1000)} HUGE_END`

    const result = await runDeriveStages({
      records: inMemoryRecordStore(),
      indexerId: 'kb',
      namespace,
      stages: [stage],
      document: document('oversized'),
      chunks: [chunk('small-1', 0, 'SMALL_ONE'), chunk('huge', 1, huge), chunk('small-2', 2, 'SMALL_TWO')],
    })

    expect(model.generateObject).toHaveBeenCalledTimes(3)
    expect(result[0]?.claims).toBe(3)
    expect(result[0]?.warnings[0]).toMatch(/Derive refs truncated chunk for source doc-1 chunk huge: \d+ -> \d+ chars\./)
    expect(prompts[0]).toContain('SMALL_ONE')
    expect(prompts[1]).toContain('HUGE_START')
    expect(prompts[1]).not.toContain('HUGE_END')
    expect(prompts[2]).toContain('SMALL_TWO')
  })

  it('caches unchanged sources and invalidates only the extraction contract version', async () => {
    const records = inMemoryRecordStore()
    const model = relationModel()
    const stage = relate({ id: 'refs', version: 1, types: relationTypes, model })
    const args = { records, indexerId: 'kb', namespace, stages: [stage], document: document(), chunks: [chunk('c1', 0, 'alpha')] }

    await runDeriveStages(args)
    await runDeriveStages(args)
    expect(model.generateObject).toHaveBeenCalledTimes(1)

    const key = manifestKey('refs')
    const manifest = await readClaimManifest(records, key)
    expect(manifest?.extractionContractVersion).toBe(EXTRACTION_CONTRACT_VERSION)
    await records.put(key, { ...manifest!, extractionContractVersion: EXTRACTION_CONTRACT_VERSION - 1 })

    await runDeriveStages(args)
    expect(model.generateObject).toHaveBeenCalledTimes(2)
  })

  it('reads each valid cache manifest only once on cache hits', async () => {
    const stages = [
      relate({ id: 'refs', version: 1, types: relationTypes, model: relationModel() }),
      assertions({ id: 'facts', version: 1, types: assertionTypes, model: assertionModel([]) }),
    ]

    for (const stage of stages) {
      const records = inMemoryRecordStore()
      const args = {
        records,
        indexerId: 'kb',
        namespace,
        stages: [stage],
        document: document(),
        chunks: [chunk('c1', 0, 'alpha')],
      }
      await runDeriveStages(args)
      const get = vi.spyOn(records, 'get')

      await runDeriveStages(args)

      const key = manifestKey(stage.id)
      expect(get.mock.calls.filter(([recordKey]) => recordKey === key)).toHaveLength(1)
    }
  })

  it('batches multimodal evidence with the same budget and keeps parts validation', async () => {
    const assets = inMemoryAssetStore()
    const stored = await assets.put({ type: 'data', data: new Uint8Array([1]), mediaType: 'image/png' })
    const partCounts: number[] = []
    const generateObject = vi.fn(async () => ({ object: { claims: [] } }))
    const generateObjectFromParts = vi.fn(async (args: { readonly parts: readonly KnowledgeContentPart[] }) => {
      partCounts.push(args.parts.length)
      return { object: { claims: claimsForPrompt(args.parts[0]?.kind === 'text' ? args.parts[0].text : '') } }
    })
    const model = knowledgeModel({
      name: 'media-relations',
      version: '1',
      modalities: ['text', 'image'],
      generateText: async () => ({ text: '', usage: undefined, response: undefined }) as never,
      generateObject,
      generateObjectFromParts,
    })
    const stage = relate({ id: 'refs', version: 1, types: relationTypes, model })
    const mediaChunks = Array.from({ length: 5 }, (_, index) => mediaChunk(`m${index + 1}`, index, stored.ref))

    const result = await runDeriveStages({
      records: inMemoryRecordStore(),
      indexerId: 'kb',
      namespace,
      stages: [stage],
      document: document('media'),
      chunks: mediaChunks,
      assets,
    })

    expect(generateObject).not.toHaveBeenCalled()
    expect(generateObjectFromParts).toHaveBeenCalledTimes(2)
    expect(partCounts).toEqual([9, 3])
    expect(result).toEqual([{ stageId: 'refs', status: 'ran', claims: 5, warnings: [] }])
  })
})

async function runRelationWithPrompts(chunks: readonly CruxChunk[]) {
  const records = inMemoryRecordStore()
  const prompts: string[] = []
  const stage = relate({ id: 'refs', version: 1, types: relationTypes, model: relationModel(prompts) })
  await runDeriveStages({ records, indexerId: 'kb', namespace, stages: [stage], document: document(), chunks })
  return { prompts, manifest: await records.get(manifestKey('refs')) }
}

function relationModel(prompts: string[] = []): KnowledgeModel {
  return fixedRelationModel(undefined, prompts)
}

function fixedRelationModel(objects?: readonly unknown[], prompts: string[] = []): KnowledgeModel {
  let index = 0
  return {
    name: 'relation-extractor',
    fingerprint: 'relation-fp',
    generateText: async () => ({ text: '', usage: undefined, response: undefined }) as never,
    generateObject: vi.fn(async ({ prompt }) => {
      prompts.push(prompt)
      return { object: objects?.[index++] ?? { claims: claimsForPrompt(prompt) } }
    }),
  }
}

function assertionModel(prompts: string[]): KnowledgeModel {
  return fixedAssertionModel(undefined, prompts)
}

function fixedAssertionModel(objects?: readonly unknown[], prompts: string[] = []): KnowledgeModel {
  let index = 0
  return {
    name: 'assertion-extractor',
    fingerprint: 'assertion-fp',
    generateText: async () => ({ text: '', usage: undefined, response: undefined }) as never,
    generateObject: vi.fn(async ({ prompt }) => {
      prompts.push(prompt)
      return {
        object: objects?.[index++] ?? {
          assertions: chunkIdsFromPrompt(prompt).map((chunkId) =>
            ({ type: 'fact', data: { value: chunkId }, evidence: [chunkRef(chunkId)] })),
        },
      }
    }),
  }
}

function claimsForPrompt(prompt: string) {
  return chunkIdsFromPrompt(prompt).map((chunkId) => ({
    type: 'mentions',
    from: chunkRef(chunkId),
    to: { kind: 'entity' as const, entityId: chunkId },
    evidence: [chunkRef(chunkId)],
  }))
}

function chunkIdsFromPrompt(prompt: string): string[] {
  return [...prompt.matchAll(/\[(?:doc-1\/)?([a-z0-9-]+)\]/g)].map((match) => match[1]!)
}

function manifestKey(stageId: string): string {
  return claimManifestKey({ indexerId: 'kb', namespace, stageId, sourceId })
}

function document(content = 'document body'): CruxDocument {
  return { namespace, sourceId, title: 'Doc One', content, metadata: {} }
}

function chunk(chunkId: string, ordinal: number, content: string): CruxChunk {
  return { namespace, sourceId, chunkId, ordinal, content, metadata: {} }
}

function mediaChunk(chunkId: string, ordinal: number, assetRef: { readonly uri: string }): CruxChunk {
  return { ...chunk(chunkId, ordinal, ''), source: { mediaType: 'image/png', assetRef } }
}

function chunkRef(chunkId: string) {
  return { kind: 'chunk' as const, sourceId, chunkId }
}

function sizedContent(size: number, marker: string): string {
  return `${marker}|${'x'.repeat(size - marker.length - 1)}`
}
