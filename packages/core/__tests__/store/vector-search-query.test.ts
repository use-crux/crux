import { describe, expect, it } from 'vitest'
import { inMemoryCruxStore } from '../../store/memory'

describe('CruxStore.searchVectors', () => {
  it('supports dense queries', async () => {
    const store = inMemoryCruxStore()
    await store.set('k1', { embedding: [1, 0] })
    await store.set('k2', { embedding: [0, 1] })

    const result = await store.searchVectors!({ dense: [1, 0] })
    expect(result[0]?.key).toBe('k1')
  })

  it('supports sparse queries', async () => {
    const store = inMemoryCruxStore()
    await store.set('k1', { sparseEmbedding: { indices: [0, 2], values: [1, 2] } })
    await store.set('k2', { sparseEmbedding: { indices: [1], values: [5] } })

    const result = await store.searchVectors!({
      sparse: { indices: [0, 2], values: [1, 2] },
    })

    expect(result[0]?.key).toBe('k1')
  })

  it('supports hybrid queries', async () => {
    const store = inMemoryCruxStore()
    await store.set('k1', {
      embedding: [1, 0],
      sparseEmbedding: { indices: [0], values: [1] },
    })
    await store.set('k2', {
      embedding: [0.9, 0.1],
      sparseEmbedding: { indices: [1], values: [1] },
    })

    const result = await store.searchVectors!({
      dense: [1, 0],
      sparse: { indices: [0], values: [1] },
    })

    expect(result[0]?.key).toBe('k1')
  })

  it('throws for empty queries', async () => {
    const store = inMemoryCruxStore()
    await expect(store.searchVectors!({})).rejects.toThrow('dense or sparse')
  })
})
