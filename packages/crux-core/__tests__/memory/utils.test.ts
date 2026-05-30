import { describe, it, expect } from 'vitest'
import { toStoreValue, toMemoryEntry } from '../../memory/utils'
import type { RawMemoryDocument } from '../../memory/utils'

describe('toStoreValue', () => {
  const now = Date.now()
  const baseDoc: RawMemoryDocument = {
    key: 'test-key',
    content: 'Hello world',
    metadata: { tag: 'important' },
    embedding: [0.1, 0.2, 0.3],
    createdAt: now - 1000,
    updatedAt: now,
  }

  it('converts raw doc to JsonObject with number timestamps', () => {
    const value = toStoreValue(baseDoc)
    expect(value.content).toBe('Hello world')
    expect(value.createdAt).toBe(now - 1000)
    expect(value.updatedAt).toBe(now)
  })

  it('defaults metadata to empty object when undefined', () => {
    const doc: RawMemoryDocument = { ...baseDoc, metadata: undefined }
    const value = toStoreValue(doc)
    expect(value.metadata).toEqual({})
  })

  it('preserves metadata when provided', () => {
    const value = toStoreValue(baseDoc)
    expect(value.metadata).toEqual({ tag: 'important' })
  })

  it('preserves optional embedding field', () => {
    const value = toStoreValue(baseDoc)
    expect(value.embedding).toEqual([0.1, 0.2, 0.3])
  })

  it('handles missing embedding (undefined)', () => {
    const doc: RawMemoryDocument = { ...baseDoc, embedding: undefined }
    const value = toStoreValue(doc)
    expect(value.embedding).toBeUndefined()
  })

  it('toMemoryEntry is an alias for toStoreValue', () => {
    expect(toMemoryEntry).toBe(toStoreValue)
  })
})
