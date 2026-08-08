import { sha256Hex } from '../../src/content/sha256'
import type { Asset } from '../../src/asset'
import { createIndexedChunkRecord } from '../../src/indexed-knowledge/records'
import { createStoredEvidence } from '../../src/indexing/stored-evidence'
import type { CruxChunk, CruxDocument, StoredEvidenceDocument, StoredEvidenceOrigin } from '../../src/indexing'
import type { IndexedChunkRecord } from '../../src/indexed-knowledge/records'
import type { JsonObject } from '../../src/storage'

const encoder = new TextEncoder()

/** Exact closed producer identity for plain-text schema-2 fixture sources. */
export const textFixtureProducer = Object.freeze({
  kind: 'parser' as const,
  name: 'text' as const,
  version: 'test:text-parser:2',
  adapterVersion: 'test:text-adapter:2',
})

/** Exact closed producer identity for schema-2 media fixture sources. */
export const mediaFixtureProducer = Object.freeze({
  kind: 'parser' as const,
  name: 'text' as const,
  version: 'test:media-parser:2',
  adapterVersion: 'test:media-adapter:2',
})

/** Build a truthful schema-2 text document with one stable source block. */
export function schema2TextDocument(
  input: Omit<CruxDocument, 'evidence' | 'parts'> & { readonly content: string; readonly blockId?: string },
): CruxDocument {
  const { blockId: explicitBlockId, ...document } = input
  const evidence = schema2TextDocumentEvidence(document.content)
  const blockId = explicitBlockId ?? textBlockId(document.sourceId)
  const origin = schema2TextOrigin(evidence, blockId)

  return {
    ...document,
    evidence,
    parts: [{ id: blockId, kind: 'text', content: document.content, evidence: origin }],
  }
}

/** Build a truthful schema-2 media document with one stable media source block. */
export function schema2MediaDocument(
  input: Omit<CruxDocument, 'asset' | 'evidence' | 'parts'> & {
    readonly asset: Asset
    readonly mediaPartId?: string
    readonly additionalMediaParts?: readonly { readonly id: string; readonly asset: Asset }[]
  },
): CruxDocument {
  const { asset, mediaPartId: explicitPartId, additionalMediaParts = [], ...document } = input
  const documentSha256 = mediaDocumentSha256([asset, ...additionalMediaParts.map((part) => part.asset)])
  const partId = explicitPartId ?? `media:${document.sourceId}`
  const evidence: StoredEvidenceDocument = {
    documentSha256,
    producer: mediaFixtureProducer,
    normalizationVersion: 'test:media-normalization:2',
  }
  const origin: StoredEvidenceOrigin = {
    coordinate: { kind: 'document', documentSha256 },
    producer: mediaFixtureProducer,
    blockIds: [partId],
  }

  return {
    ...document,
    evidence,
    parts: [
      ...(document.content === undefined
        ? []
        : [
            {
              id: textBlockId(document.sourceId),
              kind: 'text' as const,
              content: document.content,
              evidence: {
                ...origin,
                blockIds: [textBlockId(document.sourceId)],
              },
            },
          ]),
      { id: partId, kind: 'media', asset, evidence: origin },
      ...additionalMediaParts.map((part) => ({
        id: part.id,
        kind: 'media' as const,
        asset: part.asset,
        evidence: { ...origin, blockIds: [part.id] },
      })),
    ],
  }
}

/** Build a truthful schema-2 chunk whose document coordinate names its source text. */
export function schema2TextChunk(
  input: Omit<CruxChunk, 'evidence'> & { readonly documentContent?: string; readonly blockId?: string },
): CruxChunk {
  const { documentContent, blockId: explicitBlockId, ...chunk } = input
  const document = schema2TextDocumentEvidence(documentContent ?? chunk.content)
  const origin = schema2TextOrigin(document, explicitBlockId ?? textBlockId(chunk.sourceId))

  return {
    ...chunk,
    evidence: createStoredEvidence({
      document,
      origin,
      chunkId: chunk.chunkId,
      normalizedContent: chunk.content,
      chunkerVersion: 'test:text-chunker:2',
    }),
  }
}

/** Build a validated persisted schema-2 chunk record. */
export function schema2TextRecord(input: {
  readonly indexerId: string
  readonly chunk: Omit<CruxChunk, 'evidence'> & { readonly documentContent?: string; readonly blockId?: string }
  readonly generationId?: string
  readonly now?: number
}): IndexedChunkRecord {
  return createIndexedChunkRecord({
    indexerId: input.indexerId,
    generationId: input.generationId ?? 'test-generation',
    chunk: schema2TextChunk(input.chunk),
    now: input.now ?? 1,
  })
}

/** Deliberately evidence-free input for rejection coverage; never use for a passing fixture. */
export function legacyTextChunk(input: Omit<CruxChunk, 'evidence'>): CruxChunk {
  return { ...input }
}

/** Deliberately legacy persisted records for rejection coverage; never use for a passing fixture. */
export function legacyTextRecord(
  record: IndexedChunkRecord,
  kind: 'missing-evidence' | 'schema-1-evidence',
): JsonObject {
  if (kind === 'missing-evidence') {
    const { evidence: _, ...legacy } = record
    return legacy
  }

  return {
    ...record,
    evidence: { ...record.evidence!, schemaVersion: 1 },
  } as unknown as JsonObject
}

function schema2TextDocumentEvidence(content: string): StoredEvidenceDocument {
  return {
    documentSha256: sha256Hex(encoder.encode(content)),
    producer: textFixtureProducer,
    normalizationVersion: 'test:text-normalization:2',
  }
}

function schema2TextOrigin(document: StoredEvidenceDocument, blockId: string): StoredEvidenceOrigin {
  return {
    coordinate: { kind: 'document', documentSha256: document.documentSha256 },
    producer: textFixtureProducer,
    blockIds: [blockId],
  }
}

function textBlockId(sourceId: string): string {
  return `text:${sourceId}`
}

function mediaDocumentSha256(assets: readonly Asset[]): string {
  return sha256Hex(encoder.encode(assets.map(mediaAssetIdentity).join('\n')))
}

function mediaAssetIdentity(asset: Asset): string {
  if (asset.type === 'data') {
    if (!(asset.data instanceof Uint8Array)) {
      throw new TypeError('schema2MediaDocument fixtures require Uint8Array data assets.')
    }
    return sha256Hex(asset.data)
  }
  if (asset.type === 'url') {
    return sha256Hex(encoder.encode(asset.url.href))
  }
  return sha256Hex(encoder.encode(`${asset.provider}:${asset.fileId}`))
}
