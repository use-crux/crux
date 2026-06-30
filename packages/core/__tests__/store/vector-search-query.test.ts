import { describe, expect, it } from 'vitest'
import { inMemoryVectorStore } from '../../storage'

describe('VectorStore.search', () => {
  it('supports dense queries', async () => {
    const vectors = inMemoryVectorStore()
    await vectors.upsert([
      { key: 'k1', dense: [1, 0] },
      { key: 'k2', dense: [0, 1] },
    ])

    const result = await vectors.search({ mode: 'dense', dense: [1, 0] })

    expect(result[0]?.key).toBe('k1')
  })

  it('supports sparse queries', async () => {
    const vectors = inMemoryVectorStore()
    await vectors.upsert([
      { key: 'k1', sparse: { indices: [0, 2], values: [1, 2] } },
      { key: 'k2', sparse: { indices: [1], values: [5] } },
    ])

    const result = await vectors.search({
      mode: 'sparse',
      sparse: { indices: [0, 2], values: [1, 2] },
    })

    expect(result[0]?.key).toBe('k1')
  })

  it('supports hybrid queries', async () => {
    const vectors = inMemoryVectorStore()
    await vectors.upsert([
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

    const result = await vectors.search({
      mode: 'hybrid',
      dense: [1, 0],
      sparse: { indices: [0], values: [1] },
    })

    expect(result[0]?.key).toBe('k1')
  })

  it('throws for invalid query modes at runtime', async () => {
    const vectors = inMemoryVectorStore()

    await expect(vectors.search({} as never)).rejects.toThrow('Vector search mode')
  })
})
