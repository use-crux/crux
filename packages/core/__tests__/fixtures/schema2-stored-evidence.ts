import { sha256Hex } from '../../src/content/sha256'
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
