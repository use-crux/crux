import { describe, expect, it } from 'vitest'
import { embedding } from '../../src/embedding'
import { indexer } from '../../src/indexing'
import { inMemoryRecordStore, inMemoryVectorStore } from '../../src/storage'

function indexerFingerprint(options: {
  version?: string
  batch?: { maxSize: number; concurrency?: number }
  retry?: { maxAttempts: number; baseDelayMs?: number }
}): string {
  const dense = embedding({
    kind: 'dense',
    name: 'dense-test',
    dimensions: 2,
    maxInputTokens: 100,
    batch: options.batch ?? { maxSize: 8 },
    retry: options.retry,
    version: options.version,
    embed: async (inputs) => inputs.map(() => [1, 2]),
  })
  return indexer({
    id: 'docs',
    namespace: 'kb',
    records: inMemoryRecordStore(),
    vectors: inMemoryVectorStore(),
    dense,
  }).fingerprint()
}

describe('indexer embedding identity', () => {
  it('tracks vector semantics without tracking operational policy', () => {
    const base = indexerFingerprint({ version: 'v1' })

    expect(indexerFingerprint({ version: 'v2' })).not.toBe(base)
    expect(indexerFingerprint({ version: 'v1', batch: { maxSize: 2, concurrency: 2 } })).toBe(base)
    expect(indexerFingerprint({ version: 'v1', retry: { maxAttempts: 3, baseDelayMs: 1 } })).toBe(base)
  })
})
