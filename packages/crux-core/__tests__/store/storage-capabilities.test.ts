import { describe, expect, it } from 'vitest'
import {
  inMemoryBlobStore,
  inMemoryDataStore,
  inMemoryStorage,
  inMemoryVectorStore,
  storage,
} from '../../storage'

describe('storage capabilities', () => {
  it('keeps document data, vector search, and blobs as explicit capabilities', async () => {
    const data = inMemoryDataStore()
    const vectors = inMemoryVectorStore()
    const blobs = inMemoryBlobStore()
    const bundle = storage({ data, vectors, blobs })

    await bundle.data.set('docs:a', { title: 'Alpha' })
    await bundle.vectors?.upsert([{ key: 'docs:a', dense: [1, 0] }])
    const blob = await bundle.blobs?.put({
      key: 'outputs/report.txt',
      content: 'report',
      mimeType: 'text/plain',
    })

    await expect(bundle.data.get('docs:a')).resolves.toMatchObject({ title: 'Alpha' })
    await expect(bundle.vectors?.search({ dense: [1, 0] })).resolves.toEqual([
      expect.objectContaining({ key: 'docs:a', score: 1 }),
    ])
    await expect(bundle.blobs?.get(blob?.uri ?? '')).resolves.toMatchObject({
      mimeType: 'text/plain',
      size: 6,
    })
    expect(Object.isFrozen(bundle)).toBe(true)
  })

  it('does not pretend a data store is a vector or blob store', () => {
    const data = inMemoryDataStore()

    expect('search' in data).toBe(false)
    expect('put' in data).toBe(false)
  })

  it('provides a complete in-memory bundle for tests and demos', () => {
    const bundle = inMemoryStorage()

    expect(bundle.data._tag).toBe('DataStore')
    expect(bundle.vectors?._tag).toBe('VectorStore')
    expect(bundle.blobs?._tag).toBe('BlobStore')
  })
})
