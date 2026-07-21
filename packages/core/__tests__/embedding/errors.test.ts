import { describe, expect, it } from 'vitest'
import {
  EmbeddingModalityError,
  EmbeddingSpaceMismatchError,
} from '../../src/embedding'

describe('embedding errors', () => {
  it('explains how to replace a text-only embedding for media input', () => {
    const error = new EmbeddingModalityError({
      embeddingName: 'text-embedding-3-small',
      modality: 'image',
      supported: ['text'],
    })

    expect(error).toMatchObject({
      name: 'EmbeddingModalityError',
      embeddingName: 'text-embedding-3-small',
      modality: 'image',
      supported: ['text'],
    })
    expect(error.message).toContain('accepts text only')
    expect(error.message).toContain('gemini-embedding-2')
  })

  it('describes both incompatible vector spaces and the recovery', () => {
    const error = new EmbeddingSpaceMismatchError({
      namespace: 'products',
      expected: 'a'.repeat(64),
      actual: 'b'.repeat(64),
      expectedSpace: { name: 'gemini-embedding-2', dimensions: 1408 },
      actualSpace: { name: 'text-embedding-3-small', dimensions: 1536 },
    })

    expect(error).toMatchObject({
      name: 'EmbeddingSpaceMismatchError',
      namespace: 'products',
      expected: 'a'.repeat(64),
      actual: 'b'.repeat(64),
    })
    expect(error.message).toContain('"gemini-embedding-2" (1408d)')
    expect(error.message).toContain('"text-embedding-3-small" (1536d)')
    expect(error.message).toContain('re-index the namespace')
  })
})
