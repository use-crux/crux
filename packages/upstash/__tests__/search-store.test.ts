import { StorageError } from '@use-crux/core/storage'
import { describeSearchStoreConformance } from '@use-crux/core/storage/testing/vitest'
import { describe, expect, it } from 'vitest'
import { upstashSearchStore } from '../src/search-store'
import { createFakeUpstashSearchIndex } from './fake-upstash-search'

describeSearchStoreConformance(
  {
    name: 'upstashSearchStore',
    prepare: () => {
      const { index } = createFakeUpstashSearchIndex()
      return upstashSearchStore({ index, namespace: 'docs' })
    },
  },
  { describe, expect, it },
)

describe('upstashSearchStore', () => {
  it('rejects unsupported filter values before querying Upstash', async () => {
    const { index, namespace } = createFakeUpstashSearchIndex()
    const search = upstashSearchStore({ index, namespace: 'docs' })

    await expect(
      search.search({
        legs: [{ kind: 'dense', vector: [1, 0] }],
        filter: { tags: ['launch'] } as never,
      }),
    ).rejects.toMatchObject({
      code: 'invalid_filter',
    })
    await expect(
      search.search({
        legs: [{ kind: 'dense', vector: [1, 0] }],
        filter: { 'metadata.topic': 'launch' } as never,
      }),
    ).rejects.toBeInstanceOf(StorageError)
    expect(namespace.query).not.toHaveBeenCalled()
  })

  it('queries dense and sparse legs separately and returns raw per-leg matches', async () => {
    const { index, namespace } = createFakeUpstashSearchIndex()
    const search = upstashSearchStore({ index, namespace: 'docs' })
    await search.upsert([
      { key: 'a', dense: [1, 0], sparse: { indices: [1], values: [0.2] } },
      { key: 'b', dense: [0.9, 0.1], sparse: { indices: [1], values: [1] } },
    ])

    const results = await search.search({
      legs: [
        { kind: 'dense', vector: [1, 0], candidates: 2 },
        { kind: 'sparse', vector: { indices: [1], values: [1] }, candidates: 2 },
      ],
      fusion: { strategy: 'rrf' },
      limit: 2,
    })

    expect(namespace.query).toHaveBeenCalledTimes(2)
    expect(namespace.query).toHaveBeenNthCalledWith(1, expect.objectContaining({ vector: [1, 0], topK: 2 }))
    expect(namespace.query).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ sparseVector: { indices: [1], values: [1] }, topK: 2 }),
    )
    expect(results[0]).toMatchObject({
      key: 'a',
      matches: [
        { kind: 'dense', rank: 1, score: 1 },
        { kind: 'sparse', rank: 2, score: 0.2 },
      ],
    })
  })

  it('does not accept unsupported fusion modes', async () => {
    const { index } = createFakeUpstashSearchIndex()
    const search = upstashSearchStore({ index, namespace: 'docs' })

    await expect(
      search.search({
        legs: [{ kind: 'dense', vector: [1, 0] }],
        fusion: { strategy: 'weighted' } as never,
      }),
    ).rejects.toMatchObject({ code: 'unsupported_capability' })
  })
})
