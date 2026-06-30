import { StorageError } from '@use-crux/core/storage'
import { describeVectorStoreConformance } from '@use-crux/core/storage/testing/vitest'
import { describe, expect, it } from 'vitest'
import { upstashVectorStore } from '../vector-store'
import { createFakeUpstashVectorIndex } from './fake-upstash-vector'

describeVectorStoreConformance({
  name: 'upstashVectorStore',
  prepare: () => {
    const { index } = createFakeUpstashVectorIndex()
    return upstashVectorStore({ index, namespace: 'docs' })
  },
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
