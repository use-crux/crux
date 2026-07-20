import { describe, expect, it } from 'vitest'
import type { GoogleGenAI } from '@google/genai'
import { embedding } from '../src/embedding'
import type { GoogleEmbeddingConfig } from '../src/types'

const client = {} as GoogleGenAI

function fingerprint(overrides: Partial<GoogleEmbeddingConfig> = {}): string | undefined {
  return embedding(client, {
    name: 'same-name',
    model: 'model-a',
    dimensions: 2,
    maxInputTokens: 100,
    ...overrides,
  }).fingerprint
}

describe('Google embedding identity', () => {
  it('merges vector-producing request fields with user version and excludes batch policy', () => {
    const base = fingerprint()

    expect(fingerprint({ model: 'model-b' })).not.toBe(base)
    expect(fingerprint({ taskType: 'RETRIEVAL_DOCUMENT' })).not.toBe(base)
    expect(fingerprint({ title: 'Document title' })).not.toBe(base)
    expect(fingerprint({ mimeType: 'text/markdown' })).not.toBe(base)
    expect(fingerprint({ autoTruncate: true })).not.toBe(base)
    expect(fingerprint({ version: 'revision-2' })).not.toBe(base)
    expect(fingerprint({ model: 'model-b', version: 'pinned' })).not.toBe(
      fingerprint({ model: 'model-a', version: 'pinned' }),
    )
    expect(fingerprint({ batch: { maxSize: 2, concurrency: 2 } })).toBe(base)
  })
})
