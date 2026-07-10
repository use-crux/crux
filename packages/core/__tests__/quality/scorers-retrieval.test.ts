import { describe, expect, it } from 'vitest'
import { scorers } from '../../src/quality/scorers'

/** Ranked hits as a retriever task would output them. */
const hits = (...sourceIds: string[]) => sourceIds.map((sourceId, index) => ({ sourceId, rank: index + 1 }))

const expectedSources = (...sourceIds: string[]) => ({ sources: sourceIds.map((sourceId) => ({ sourceId })) })

describe('scorers.retrieval.hitRateAtK', () => {
  it('scores 1 when an expected source appears in the top k', async () => {
    const scorer = scorers.retrieval.hitRateAtK(3)
    const score = await scorer({
      input: { query: 'q' },
      output: hits('a', 'b', 'c', 'd'),
      expected: expectedSources('c'),
    })
    expect(score).toMatchObject({ name: 'hitRate@3', score: 1 })
  })

    it('scores 0 when the expected source ranks below k', async () => {
    const scorer = scorers.retrieval.hitRateAtK(2)
    const score = await scorer({
      input: { query: 'q' },
      output: hits('a', 'b', 'c'),
      expected: expectedSources('c'),
    })
    expect(score.score).toBe(0)
  })

    it('returns null without an expected payload', async () => {
    const scorer = scorers.retrieval.hitRateAtK(3)
    const score = await scorer({ input: {}, output: hits('a'), expected: undefined })
    expect(score.score).toBeNull()
  })

    it('throws a clear error when expected does not match the { sources } shape', () => {
    const scorer = scorers.retrieval.hitRateAtK(3)
    expect(() => scorer({ input: {}, output: hits('a'), expected: { wrong: true } })).toThrow(/expected.*sources/i)
  })

    it('reads hits from a `{ hits }` record output and degrades to null for non-hit outputs', async () => {
    const scorer = scorers.retrieval.hitRateAtK(2)
    const fromRecord = await scorer({ input: {}, output: { hits: hits('a') }, expected: expectedSources('a') })
    expect(fromRecord.score).toBe(1)

    const fromText = await scorer({ input: {}, output: 'plain text answer', expected: expectedSources('a') })
    expect(fromText.score).toBeNull()
    expect(fromText.metadata?.reason).toMatch(/ranked hit list/)
  })
})

describe('scorers.retrieval.recallAtK / precisionAtK', () => {
  it('recall@k = fraction of expected sources present in the top k', async () => {
    const scorer = scorers.retrieval.recallAtK(2)
    const score = await scorer({
      input: {},
      output: hits('a', 'b', 'c'),
      expected: expectedSources('a', 'c'),
    })
    expect(score).toMatchObject({ name: 'recall@2', score: 0.5 })
  })

    it('precision@k = fraction of the top k that are expected sources (denominator k)', async () => {
    const scorer = scorers.retrieval.precisionAtK(4)
    const score = await scorer({
      input: {},
      output: hits('a', 'x', 'b', 'y'),
      expected: expectedSources('a', 'b'),
    })
    expect(score).toMatchObject({ name: 'precision@4', score: 0.5 })
  })

    it('chunkId in an expected source must match the hit chunk', async () => {
    const scorer = scorers.retrieval.recallAtK(3)
    const score = await scorer({
      input: {},
      output: [{ sourceId: 'a', chunkId: 'c1' }],
      expected: { sources: [{ sourceId: 'a', chunkId: 'c2' }] },
    })
    expect(score.score).toBe(0)
  })
})

describe('scorers.retrieval.mrr / ndcg', () => {
  it('mrr = reciprocal rank of the first expected source, 0 when absent', async () => {
    const scorer = scorers.retrieval.mrr()
    const found = await scorer({ input: {}, output: hits('x', 'a'), expected: expectedSources('a') })
    expect(found).toMatchObject({ name: 'mrr', score: 0.5 })

    const missing = await scorer({ input: {}, output: hits('x', 'y'), expected: expectedSources('a') })
    expect(missing.score).toBe(0)
  })

    it('ndcg@k is 1 for a perfect ranking and discounts late hits', async () => {
    const perfect = await scorers.retrieval.ndcg(2)({
      input: {},
      output: hits('a', 'b'),
      expected: expectedSources('a', 'b'),
    })
    expect(perfect.name).toBe('ndcg@2')
    expect(perfect.score).toBeCloseTo(1, 10)

    const late = await scorers.retrieval.ndcg(2)({
      input: {},
      output: hits('x', 'a'),
      expected: expectedSources('a'),
    })
    // DCG = 1/log2(3); IDCG = 1/log2(2) = 1.
    expect(late.score).toBeCloseTo(1 / Math.log2(3), 10)
  })

    it('hits carrying ranks are sorted by rank before measuring', async () => {
    const scorer = scorers.retrieval.mrr()
    const score = await scorer({
      input: {},
      output: [
        { sourceId: 'a', rank: 2 },
        { sourceId: 'b', rank: 1 },
      ],
      expected: expectedSources('a'),
    })
    expect(score.score).toBe(0.5)
  })
})
