import { describe, expect, it } from 'vitest'
import { inMemorySearchStore } from '../../src/storage'

describe('SearchStore.search', () => {
  it('supports dense queries', async () => {
    const search = inMemorySearchStore()
    await search.upsert([
      { key: 'k1', dense: [1, 0] },
      { key: 'k2', dense: [0, 1] },
    ])

    const result = await search.search({ legs: [{ kind: 'dense', vector: [1, 0] }] })

    expect(result[0]?.key).toBe('k1')
  })

  it('supports sparse queries', async () => {
    const search = inMemorySearchStore()
    await search.upsert([
      { key: 'k1', sparse: { indices: [0, 2], values: [1, 2] } },
      { key: 'k2', sparse: { indices: [1], values: [5] } },
    ])

    const result = await search.search({
      legs: [{ kind: 'sparse', vector: { indices: [0, 2], values: [1, 2] } }],
    })

    expect(result[0]?.key).toBe('k1')
  })

  it('supports dense and sparse fused queries', async () => {
    const search = inMemorySearchStore()
    await search.upsert([
      {
        key: 'k1',
        dense: [1, 0],
        sparse: { indices: [0], values: [1] },
      },
      {
        key: 'k2',
        dense: [0.9, 0.1],
        sparse: { indices: [1], values: [1] },
      },
    ])

    const result = await search.search({
      legs: [
        { kind: 'dense', vector: [1, 0] },
        { kind: 'sparse', vector: { indices: [0], values: [1] } },
      ],
    })

    expect(result[0]?.key).toBe('k1')
  })

  it('throws for invalid query modes at runtime', async () => {
    const search = inMemorySearchStore()

    await expect(search.search({} as never)).rejects.toThrow('Search query requires one to three legs')
  })
})
