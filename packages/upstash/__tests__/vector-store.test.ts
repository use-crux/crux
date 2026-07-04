import { StorageError } from '@use-crux/core/storage'
import { inMemoryRecordStore } from '@use-crux/core/storage'
import { vectorStoreConformanceSuite } from '@use-crux/core/storage/testing/vitest'
import { describe, expect, it } from 'vitest'
import { upstashVectorStore } from '../vector-store'
import { createFakeUpstashVectorIndex } from './fake-upstash-vector'

vectorStoreConformanceSuite({
  name: 'upstashVectorStore',
  create: () => {
    const { index } = createFakeUpstashVectorIndex()
    return {
      records: inMemoryRecordStore(),
      vectors: upstashVectorStore({ index, namespace: 'docs' }),
      cleanup: async () => {},
    }
  },
  capabilities: { sparse: false, hybrid: false, delete: true },
})

describe('upstashVectorStore', () => {
  it('rejects unsupported filter values before querying Upstash', async () => {
    const { index, namespace } = createFakeUpstashVectorIndex()
    const vectors = upstashVectorStore({ index, namespace: 'docs' })

    await expect(
      vectors.search({
        mode: 'dense',
        dense: [1, 0],
        filter: { tags: ['launch'] } as never,
      }),
    ).rejects.toMatchObject({
      code: 'invalid_filter',
    })
    await expect(
      vectors.search({
        mode: 'dense',
        dense: [1, 0],
        filter: { 'metadata.topic': 'launch' } as never,
      }),
    ).rejects.toBeInstanceOf(StorageError)
    expect(namespace.query).not.toHaveBeenCalled()
  })
})
