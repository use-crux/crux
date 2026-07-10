import { describe, expect, it } from 'vitest'
import {
  inMemoryBlobStore,
  inMemoryRecordStore,
  inMemoryStorage,
  inMemoryVectorStore,
  storage,
} from '../../src/storage'

describe('storage capabilities', () => {
  it('keeps document data, vector search, and blobs as explicit capabilities', async () => {
    const records = inMemoryRecordStore()
    const vectors = inMemoryVectorStore()
    const blobs = inMemoryBlobStore()
    const bundle = storage({ records, vectors, blobs })

    await bundle.records.put('docs:a', { title: 'Alpha' })
    await bundle.vectors?.upsert([{ key: 'docs:a', dense: [1, 0] }])
    const blob = await bundle.blobs?.put({
      key: 'outputs/report.txt',
      content: 'report',
      mimeType: 'text/plain',
    })

    await expect(bundle.records.get('docs:a')).resolves.toMatchObject({ title: 'Alpha' })
    await expect(bundle.vectors?.search({ mode: 'dense', dense: [1, 0] })).resolves.toEqual([
      expect.objectContaining({ key: 'docs:a', score: 1 }),
    ])
    await expect(bundle.blobs?.get(blob?.uri ?? '')).resolves.toMatchObject({
      mimeType: 'text/plain',
      size: 6,
    })
    expect(Object.isFrozen(bundle)).toBe(true)
  })

  it('does not pretend a record store is a vector or blob store', () => {
    const records = inMemoryRecordStore()

    expect('search' in records).toBe(false)
    expect('createReadUrl' in records).toBe(false)
  })

  it('provides a complete in-memory bundle for tests and demos', () => {
    const bundle = inMemoryStorage()

    expect(bundle.records._tag).toBe('RecordStore')
    expect(bundle.vectors?._tag).toBe('VectorStore')
    expect(bundle.assets).toBeDefined()
    expect(bundle.blobs?._tag).toBe('BlobStore')
  })
})
