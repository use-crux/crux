import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { inMemoryAssetStore, inMemoryRecordStore } from '../../src/storage'
import type { CruxChunk, CruxDocument } from '../../src/indexing'
import { knowledgeModel, type KnowledgeContentPart, type KnowledgeModel } from '../../src/knowledge/model'
import { assertions } from '../../src/knowledge/assertions/assertions'
import { clusterKnowledgeCommunities } from '../../src/knowledge/communities/cluster'
import { generateCommunityReports } from '../../src/knowledge/communities/reports'
import { runDeriveStages } from '../../src/knowledge/derive/runner'
import { relate } from '../../src/knowledge/relate/relate'
import type { RetrievalModel } from '../../src/retrieval'

const sourceId = 'media-src'
const chunkId = 'img-1'
const chunkRef = { kind: 'chunk' as const, sourceId, chunkId }

describe('connected knowledge modality validation', () => {
  it('fails closed for uncovered image chunks with a text-only relation model', async () => {
    const model = textOnlyModel()
    const stage = relationStage(model)

    await expect(runDeriveStages({
      records: inMemoryRecordStore(),
      indexerId: 'kb',
      namespace: 'ns',
      stages: [stage],
      document: document(),
      chunks: [imageChunk()],
    })).rejects.toThrow(/stage "media-relations".*source "media-src".*chunks "img-1".*modality "image".*text representation.*model declaring the modality/s)
    expect(model.generateObject).not.toHaveBeenCalled()
  })

  it('passes uncovered image evidence to a multimodal relation model as parts with hydrated bytesRef', async () => {
    const assets = inMemoryAssetStore()
    const stored = await assets.put({
      type: 'data',
      data: new Uint8Array([1, 2, 3]),
      mediaType: 'image/png',
    })
    let received: readonly KnowledgeContentPart[] = []
    const generateObject = vi.fn(async () => ({ object: { claims: [] } }))
    const generateObjectFromParts = vi.fn(async (args: { readonly parts: readonly KnowledgeContentPart[] }) => {
      received = args.parts
      return { object: { claims: [{ type: 'depicts', from: chunkRef, to: { kind: 'entity', entityId: 'chart' }, evidence: [chunkRef] }] } }
    })
    const model = knowledgeModel({
      name: 'vision-extractor',
      version: '1',
      modalities: ['text', 'image'],
      generateText: async () => ({ text: '', usage: undefined, response: undefined }) as never,
      generateObject,
      generateObjectFromParts,
    })

    const result = await runDeriveStages({
      records: inMemoryRecordStore(),
      indexerId: 'kb',
      namespace: 'ns',
      stages: [relationStage(model)],
      document: document(),
      chunks: [imageChunk(stored.ref)],
      assets,
    })

    expect(result).toEqual([{ stageId: 'media-relations', status: 'ran', claims: 1, warnings: [] }])
    expect(generateObject).not.toHaveBeenCalled()
    expect(generateObjectFromParts).toHaveBeenCalledTimes(1)
    expect(received.find((part) => part.kind === 'media')).toMatchObject({
      kind: 'media',
      mediaType: 'image/png',
      bytesRef: { ref: stored.ref, type: 'data', mediaType: 'image/png' },
    })
  })

  it('fails closed when media evidence has a capable model but no asset store', async () => {
    const generateObjectFromParts = vi.fn(async () => ({ object: { claims: [] } }))
    const model = knowledgeModel({
      name: 'vision-extractor',
      version: '1',
      modalities: ['text', 'image'],
      generateText: async () => ({ text: '', usage: undefined, response: undefined }) as never,
      generateObject: vi.fn(async () => ({ object: { claims: [] } })),
      generateObjectFromParts,
    })

    await expect(runDeriveStages({
      records: inMemoryRecordStore(),
      indexerId: 'kb',
      namespace: 'ns',
      stages: [relationStage(model)],
      document: document(),
      chunks: [imageChunk({ uri: 'asset:image' })],
    })).rejects.toThrow(/stage "media-relations".*missing config\.storage\.assets/s)
    expect(generateObjectFromParts).not.toHaveBeenCalled()
  })

  it('validates assertion stages before model calls', async () => {
    const model = textOnlyModel()
    const stage = assertions({
      id: 'facts',
      version: 1,
      types: { label: z.object({ value: z.string() }) },
      model,
    })

    await expect(runDeriveStages({
      records: inMemoryRecordStore(),
      indexerId: 'kb',
      namespace: 'ns',
      stages: [stage],
      document: document(),
      chunks: [imageChunk()],
    })).rejects.toThrow(/stage "facts".*source "media-src".*chunks "img-1".*modality "image"/s)
    expect(model.generateObject).not.toHaveBeenCalled()
  })

  it('validates community report evidence before model calls', async () => {
    const model = textOnlyModel()
    const graph = {
      namespace: 'ns',
      entities: [],
      edges: [],
      chunks: [{
        ref: chunkRef,
        sourceId,
        chunkId,
        ordinal: 0,
        content: '',
        source: { mediaType: 'image/png' },
      }],
      mentionWeights: [],
      residualChunks: [{
        ref: chunkRef,
        sourceId,
        chunkId,
        ordinal: 0,
        content: '',
        source: { mediaType: 'image/png' },
      }],
    }

    await expect(generateCommunityReports({
      model,
      generationId: 'g1',
      graph,
      clustering: clusterKnowledgeCommunities(graph),
      lineage: { graphGeneration: 'kg1', strategyFingerprint: 's1', viewRevision: null },
    })).rejects.toThrow(/community ".*source "media-src".*chunks "img-1".*modality "image"/s)
    expect(model.generateObject).not.toHaveBeenCalled()
  })

  it('rejects non-text modality declarations without the multimodal hook', () => {
    expect(() => knowledgeModel({
      name: 'broken',
      version: '1',
      modalities: ['image'],
      ...retrievalModel(),
    })).toThrow(/requires generateObjectFromParts/)
  })

  it('changes fingerprints when modalities or hook presence change', () => {
    const base = knowledgeModel({ name: 'extractor', version: '1', ...retrievalModel() })
    const textWithHook = knowledgeModel({
      name: 'extractor',
      version: '1',
      ...retrievalModel(),
      generateObjectFromParts: async () => ({ object: {} }) as never,
    })
    const image = knowledgeModel({
      name: 'extractor',
      version: '1',
      modalities: ['text', 'image'],
      ...retrievalModel(),
      generateObjectFromParts: async () => ({ object: {} }) as never,
    })

    expect(base.fingerprint).not.toBe(textWithHook.fingerprint)
    expect(textWithHook.fingerprint).not.toBe(image.fingerprint)
  })

  it('leaves text-only corpora on the existing generateObject path', async () => {
    const model = textOnlyModel({ claims: [] })
    await runDeriveStages({
      records: inMemoryRecordStore(),
      indexerId: 'kb',
      namespace: 'ns',
      stages: [relationStage(model)],
      document: document('Alpha mentions Beta.'),
      chunks: [{ ...imageChunk(), content: 'Alpha mentions Beta.', source: { mediaType: 'image/png' } }],
    })

    expect(model.generateObject).toHaveBeenCalledTimes(1)
  })
})

function document(content = ''): CruxDocument {
  return { namespace: 'ns', sourceId, content, metadata: {} }
}

function imageChunk(assetRef?: { readonly uri: string }): CruxChunk {
  return {
    namespace: 'ns',
    sourceId,
    chunkId,
    ordinal: 0,
    content: '',
    metadata: {},
    source: { mediaType: 'image/png', ...(assetRef ? { assetRef } : {}) },
  }
}

function relationStage(model: KnowledgeModel) {
  return relate({
    id: 'media-relations',
    version: 1,
    types: {
      depicts: {
        from: ['chunk'] as const,
        to: ['entity'] as const,
        direction: 'directed' as const,
        description: 'A media chunk depicts an entity',
      },
    },
    model,
  })
}

function textOnlyModel(object: unknown = { claims: [] }) {
  return {
    name: 'text-extractor',
    fingerprint: 'text-extractor-v1',
    ...retrievalModel(object),
  } satisfies KnowledgeModel
}

function retrievalModel(object: unknown = {}): RetrievalModel {
  return {
    generateText: async () => ({ text: '', usage: undefined, response: undefined }) as never,
    generateObject: vi.fn(async () => ({ object })),
  }
}
