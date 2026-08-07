import { describe, expect, it } from 'vitest'
import { embedding } from '../../src/embedding'
import { chunker, indexer } from '../../src/indexing'
import { inMemoryRecordStore, inMemorySearchStore } from '../../src/storage'

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
    search: inMemorySearchStore(),
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

describe('built-in chunker strategy identity', () => {
  it('changes only page-block-aware strategy identities', () => {
    const text = chunker.text()
    const semantic = chunker.semantic({ strategy: 'custom', segment: () => [] })
    const structured = chunker.structured()
    const parentChild = chunker.parentChild()

    expect({ version: text.version, fingerprint: text.fingerprint() }).toEqual({
      version: '2', fingerprint: '0850091b',
    })
    expect({ version: semantic.version, fingerprint: semantic.fingerprint() }).toEqual({
      version: '2', fingerprint: '7946e9d7',
    })
    expect({ version: structured.version, fingerprint: structured.fingerprint() }).toEqual({
      version: '3', fingerprint: 'baafb216',
    })
    expect({ version: parentChild.version, fingerprint: parentChild.fingerprint() }).toEqual({
      version: '3', fingerprint: '3cef88ce',
    })
    expect(structured.fingerprint()).not.toBe(text.fingerprint())
    expect(structured.fingerprint()).not.toBe(semantic.fingerprint())
  })
})
