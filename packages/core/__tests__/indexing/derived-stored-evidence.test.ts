import { expect, it } from 'vitest'
import { StoredEvidenceRequiredError, chunker } from '../../src/indexing'
import { createIndexedChunkRecord } from '../../src/indexed-knowledge/records'
import type { CruxDocument, StoredEvidenceDocument, StoredEvidenceOrigin } from '../../src/indexing'

const sha = 'a'.repeat(64)
const producer = { kind: 'parser' as const, name: 'text' as const, version: 'builtin', adapterVersion: '2' }
const documentEvidence: StoredEvidenceDocument = { documentSha256: sha, producer, normalizationVersion: 'crux:ingested-document:2' }
const origin = (id: string, candidate = producer): StoredEvidenceOrigin => ({ coordinate: { kind: 'document', documentSha256: sha }, producer: candidate, blockIds: [id] })

it('gives semantic and parent-child derived chunks one document coordinate when every contributor has one producer', async () => {
  const document: CruxDocument = {
    namespace: 'kb', sourceId: 'same-producer', content: 'First sentence.\n\nSecond sentence.', evidence: documentEvidence,
    parts: [
      { id: 'one', kind: 'text', content: 'First sentence.', evidence: origin('one') },
      { id: 'two', kind: 'text', content: 'Second sentence.', evidence: origin('two') },
    ],
  }
  const semantic = await chunker.semantic({ strategy: 'custom', segment: () => [{ start: 0, end: document.content!.length }] }).chunkDocument(document, { chunking: { maxChars: 100, overlapChars: 0 } })
  const parentChild = await chunker.parentChild({ parentMaxChars: 100, childMaxChars: 100 }).chunkDocument(document, { chunking: { maxChars: 100, overlapChars: 0 } })

  expect(semantic.chunks[0]?.evidence).toMatchObject({ coordinate: { kind: 'document', documentSha256: sha }, blockIds: ['one', 'two'] })
  expect(parentChild.chunks[0]?.evidence).toMatchObject({ coordinate: { kind: 'document', documentSha256: sha }, blockIds: ['one', 'two'] })
})

it('retains only blocks intersecting each semantic and parent-child slice', async () => {
  const document: CruxDocument = {
    namespace: 'kb', sourceId: 'slice-contributors', content: 'First sentence.\n\nSecond sentence.', evidence: documentEvidence,
    parts: [
      { id: 'one', kind: 'text', content: 'First sentence.', evidence: origin('one') },
      { id: 'two', kind: 'text', content: 'Second sentence.', evidence: origin('two') },
    ],
  }
  const semantic = await chunker.semantic({
    strategy: 'custom',
    segment: () => [{ start: 0, end: 15 }, { start: 17, end: document.content!.length }],
  }).chunkDocument(document, { chunking: { maxChars: 100, overlapChars: 0 } })
  const parentChild = await chunker.parentChild({ parentMaxChars: 100, childMaxChars: 15, childOverlapChars: 0 })
    .chunkDocument(document, { chunking: { maxChars: 100, overlapChars: 0 } })

  expect(semantic.chunks.map((chunk) => chunk.evidence?.blockIds)).toEqual([['one'], ['two']])
  expect(parentChild.chunks.map((chunk) => chunk.evidence?.blockIds)).toEqual([['one'], ['two'], ['two']])
})

it('does not fabricate persistable evidence for mixed-producer derived chunks', async () => {
  const document: CruxDocument = {
    namespace: 'kb', sourceId: 'mixed-producer', content: 'First. Second.', evidence: documentEvidence,
    parts: [
      { id: 'one', kind: 'text', content: 'First.', evidence: origin('one') },
      { id: 'two', kind: 'text', content: 'Second.', evidence: origin('two', { kind: 'parser', name: 'html', version: 'builtin', adapterVersion: '2' }) },
    ],
  }
  const result = await chunker.semantic({ strategy: 'custom', segment: () => [{ start: 0, end: document.content!.length }] }).chunkDocument(document, { chunking: { maxChars: 100, overlapChars: 0 } })
  const chunk = result.chunks[0]!

  expect(chunk.evidence).toBeUndefined()
  expect(() => createIndexedChunkRecord({ indexerId: 'index', generationId: 'generation', chunk, now: 0 })).toThrow(StoredEvidenceRequiredError)
})

it('retains the media part evidence on a media-only chunk', async () => {
  const result = await chunker.structured().chunkDocument({
    namespace: 'kb', sourceId: 'media', evidence: documentEvidence,
    parts: [{
      id: 'image:1', kind: 'media', modality: 'image', caption: 'A diagram.',
      asset: { type: 'data', data: new Uint8Array([1]), mediaType: 'image/png' }, evidence: origin('image:1'),
    }],
  }, { chunking: { maxChars: 100, overlapChars: 0 } })

  expect(result.chunks[0]?.evidence).toMatchObject({ blockIds: ['image:1'], coordinate: { kind: 'document', documentSha256: sha } })
})
