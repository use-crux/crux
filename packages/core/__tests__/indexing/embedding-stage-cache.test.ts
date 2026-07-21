import { describe, expect, it } from 'vitest'
import {
  EMBEDDING_STAGE_CACHE_EPOCH,
  createDenseEmbeddingStageEntry,
  createSparseEmbeddingStageEntry,
  embeddingStageCacheKey,
  embeddingStageInputHash,
  readDenseEmbeddingStageEntry,
  readSparseEmbeddingStageEntry,
} from '../../src/indexing/embedding-stage-cache'
import type { CruxChunk } from '../../src/indexing'

function chunks(contents: readonly string[], idPrefix = 'chunk'): CruxChunk[] {
  return contents.map((content, ordinal) => ({
    namespace: 'kb',
    sourceId: 'source-a',
    chunkId: `${idPrefix}-${ordinal}`,
    ordinal,
    content,
    metadata: { ignored: idPrefix },
  }))
}

describe('embedding stage cache contract', () => {
  it('keys source bundles by ordered content and embedding identity', () => {
    const inputHash = embeddingStageInputHash(chunks(['alpha', 'beta']))
    const renamedInputHash = embeddingStageInputHash(chunks(['alpha', 'beta'], 'renamed'))
    const base = {
      scope: 'docs',
      namespace: 'kb',
      sourceId: 'source-a',
      kind: 'dense' as const,
      embeddingFingerprint: 'dense:v1',
      inputHash,
    }
    const key = embeddingStageCacheKey(base)

    expect(EMBEDDING_STAGE_CACHE_EPOCH).toBe(3)
    expect(renamedInputHash).toBe(inputHash)
    expect(key).toMatch(/^indexer:docs:namespace:kb:embedding-cache:[0-9a-f]{64}$/)
    expect(embeddingStageCacheKey({ ...base, inputHash: renamedInputHash })).toBe(key)
    expect(embeddingStageInputHash(chunks(['beta', 'alpha']))).not.toBe(inputHash)
    expect(embeddingStageInputHash(chunks(['alpha', 'changed']))).not.toBe(inputHash)
    expect(embeddingStageCacheKey({ ...base, scope: 'shared' })).not.toBe(key)
    expect(embeddingStageCacheKey({ ...base, namespace: 'other' })).not.toBe(key)
    expect(embeddingStageCacheKey({ ...base, sourceId: 'source-b' })).not.toBe(key)
    expect(embeddingStageCacheKey({ ...base, kind: 'sparse' })).not.toBe(key)
    expect(embeddingStageCacheKey({ ...base, embeddingFingerprint: 'dense:v2' })).not.toBe(key)
  })

  it('keys media by byte digest and marks media without one uncacheable', () => {
    const mediaChunk = (sha256?: string) => ({
      content: 'same caption',
      media: {
        asset: { type: 'data' as const, data: new Uint8Array([1]), mediaType: 'image/png' },
        modality: 'image' as const,
        ...(sha256 ? { sha256 } : {}),
      },
    })

    expect(embeddingStageInputHash([mediaChunk('a'.repeat(64))])).not.toBe(
      embeddingStageInputHash([mediaChunk('b'.repeat(64))]),
    )
    expect(embeddingStageInputHash([mediaChunk()])).toBeUndefined()
  })

  it('accepts only complete finite dense bundles with matching identity and dimensions', () => {
    const expected = {
      namespace: 'kb',
      sourceId: 'source-a',
      embeddingFingerprint: 'dense:v1',
      inputHash: 'input-a',
      chunkCount: 2,
      dimensions: 2,
    }
    const entry = createDenseEmbeddingStageEntry({
      ...expected,
      vectors: [
        [1, 2],
        [3, 4],
      ],
      now: 123,
    })

    expect(entry).toMatchObject({
      _cruxRecordType: 'pipeline-embedding-cache',
      version: EMBEDDING_STAGE_CACHE_EPOCH,
      kind: 'dense',
      namespace: 'kb',
      sourceId: 'source-a',
      embeddingFingerprint: 'dense:v1',
      inputHash: 'input-a',
      dimensions: 2,
      createdAt: 123,
      updatedAt: 123,
    })
    expect(readDenseEmbeddingStageEntry(entry, expected)?.vectors).toEqual([
      [1, 2],
      [3, 4],
    ])
    expect(readDenseEmbeddingStageEntry({ ...entry, version: 1 }, expected)).toBeUndefined()
    expect(readDenseEmbeddingStageEntry({ ...entry, sourceId: 'source-b' }, expected)).toBeUndefined()
    expect(readDenseEmbeddingStageEntry({ ...entry, vectors: [[1, 2]] }, expected)).toBeUndefined()
    expect(readDenseEmbeddingStageEntry({ ...entry, vectors: [[1], [2]] }, expected)).toBeUndefined()
    expect(readDenseEmbeddingStageEntry({ ...entry, vectors: [[1, 2], [3, Number.NaN]] }, expected)).toBeUndefined()
    expect(
      readDenseEmbeddingStageEntry({ ...entry, vectors: [[1, 2], [3, Number.POSITIVE_INFINITY]] }, expected),
    ).toBeUndefined()
  })

  it('accepts only complete sparse bundles valid for vector storage', () => {
    const expected = {
      namespace: 'kb',
      sourceId: 'source-a',
      embeddingFingerprint: 'sparse:v1',
      inputHash: 'input-a',
      chunkCount: 2,
    }
    const entry = createSparseEmbeddingStageEntry({
      ...expected,
      vectors: [
        { indices: [0, 2], values: [0.5, 1] },
        { indices: [1], values: [2] },
      ],
      now: 123,
    })

    expect(entry).toMatchObject({
      _cruxRecordType: 'pipeline-embedding-cache',
      version: EMBEDDING_STAGE_CACHE_EPOCH,
      kind: 'sparse',
      namespace: 'kb',
      sourceId: 'source-a',
      embeddingFingerprint: 'sparse:v1',
      inputHash: 'input-a',
      createdAt: 123,
      updatedAt: 123,
    })
    expect(readSparseEmbeddingStageEntry(entry, expected)?.vectors).toEqual([
      { indices: [0, 2], values: [0.5, 1] },
      { indices: [1], values: [2] },
    ])
    expect(readSparseEmbeddingStageEntry({ ...entry, vectors: entry.vectors.slice(0, 1) }, expected)).toBeUndefined()
    expect(
      readSparseEmbeddingStageEntry({ ...entry, vectors: [{ indices: [0, 1], values: [1] }, entry.vectors[1]] }, expected),
    ).toBeUndefined()
    expect(
      readSparseEmbeddingStageEntry({ ...entry, vectors: [{ indices: [0.5], values: [1] }, entry.vectors[1]] }, expected),
    ).toBeUndefined()
    expect(
      readSparseEmbeddingStageEntry({ ...entry, vectors: [{ indices: [-1], values: [1] }, entry.vectors[1]] }, expected),
    ).toBeUndefined()
    expect(
      readSparseEmbeddingStageEntry({ ...entry, vectors: [{ indices: [1, 1], values: [1, 2] }, entry.vectors[1]] }, expected),
    ).toBeUndefined()
    expect(
      readSparseEmbeddingStageEntry({ ...entry, vectors: [{ indices: [0], values: [Number.NaN] }, entry.vectors[1]] }, expected),
    ).toBeUndefined()
  })
})
