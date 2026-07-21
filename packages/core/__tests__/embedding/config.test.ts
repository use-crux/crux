import { describe, expect, it } from 'vitest'
import { embedding } from '../../src/embedding'

describe('embedding config', () => {
  it('rejects invalid dense config', () => {
    expect(() => embedding({
      kind: 'dense',
      name: '',
      dimensions: 0,
      maxInputTokens: 0,
      batch: { maxSize: 0, concurrency: 0 },
      embed: async () => [],
    })).toThrow()
  })

  it('rejects invalid sparse config', () => {
    expect(() => embedding({
      kind: 'sparse',
      name: '',
      maxInputTokens: 0,
      batch: { maxSize: 0, concurrency: 0 },
      embed: async () => [],
    })).toThrow()
  })

  it('rejects an empty dense modality declaration', () => {
    expect(() => embedding({
      kind: 'dense',
      name: 'empty-modalities',
      dimensions: 1,
      maxInputTokens: 100,
      modalities: [],
      batch: { maxSize: 1 },
      embed: async () => [],
    })).toThrow('must contain at least one modality')
  })

  it('rejects duplicate dense modalities', () => {
    expect(() => embedding({
      kind: 'dense',
      name: 'duplicate-modalities',
      dimensions: 1,
      maxInputTokens: 100,
      modalities: ['text', 'text'],
      batch: { maxSize: 1 },
      embed: async () => [],
    })).toThrow('must not contain duplicates')
  })

  it('rejects media modalities on sparse embeddings', () => {
    expect(() => embedding({
      kind: 'sparse',
      name: 'sparse-media',
      maxInputTokens: 100,
      modalities: ['image'],
      batch: { maxSize: 1 },
      embed: async () => [],
    })).toThrow('support the text modality only')
  })

  it('returns a frozen embedding instance', () => {
    const value = embedding({
      kind: 'dense',
      name: 'frozen',
      dimensions: 1,
      maxInputTokens: 100,
      batch: { maxSize: 1 },
      embed: async () => [[1]],
    })

    expect(Object.isFrozen(value)).toBe(true)
    expect(value._tag).toBe('Embedding')
  })
})
