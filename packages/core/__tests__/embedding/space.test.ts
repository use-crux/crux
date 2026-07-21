import { describe, expect, it } from 'vitest'
import { deriveEmbeddingSpace, embeddingSpaceDigest } from '../../src/embedding'
import { sha256Hex } from '../../src/content/sha256'
import { stableStringify } from '../../src/embedding/hashing'

describe('embedding space', () => {
  it('uses the full SHA-256 fingerprint digest deterministically', () => {
    const fingerprint = '{"kind":"dense","name":"multimodal-test"}'
    const expected = sha256Hex(new TextEncoder().encode(fingerprint))

    expect(embeddingSpaceDigest(fingerprint)).toBe(expected)
    expect(embeddingSpaceDigest(fingerprint)).toHaveLength(64)
  })

  it('derives an immutable space value from resolved dense config', () => {
    const modalities = ['text', 'image'] as const
    const tasks = { query: 'RETRIEVAL_QUERY', document: 'RETRIEVAL_DOCUMENT' }

    const space = deriveEmbeddingSpace({
      name: 'gemini-embedding-2',
      version: '2026-06',
      dimensions: 1408,
      modalities,
      normalization: 'unit',
      tasks,
    }, 'dense-fingerprint')

    expect(space).toEqual({
      name: 'gemini-embedding-2',
      version: '2026-06',
      dimensions: 1408,
      modalities: ['text', 'image'],
      normalization: 'unit',
      tasks,
      fingerprint: 'dense-fingerprint',
    })
    expect(space.modalities).not.toBe(modalities)
    expect(space.tasks).not.toBe(tasks)
    expect(Object.isFrozen(space)).toBe(true)
    expect(Object.isFrozen(space.modalities)).toBe(true)
    expect(Object.isFrozen(space.tasks)).toBe(true)
  })

  it('distinguishes every changed dense-space identity field', () => {
    const identity = {
      name: 'gemini-embedding-2',
      version: '2026-06',
      dimensions: 1408,
      modalities: ['text', 'image'],
      normalization: 'unit',
      tasks: { query: 'RETRIEVAL_QUERY', document: 'RETRIEVAL_DOCUMENT' },
    }
    const digest = (value: unknown) => embeddingSpaceDigest(stableStringify(value))
    const expected = digest(identity)

    expect([
      { ...identity, name: 'another-model' },
      { ...identity, version: '2026-07' },
      { ...identity, dimensions: 768 },
      { ...identity, modalities: ['text'] },
      { ...identity, normalization: 'none' },
      { ...identity, tasks: { ...identity.tasks, query: 'QUESTION_ANSWERING' } },
    ].map(digest)).not.toContain(expected)
  })
})
