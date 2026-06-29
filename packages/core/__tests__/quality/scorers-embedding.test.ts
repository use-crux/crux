import { describe, expect, it } from 'vitest'
import { scorers, type EmbedFn } from '../../quality/scorers'
import { invokeScorer } from '../../quality/internal/scorer-runtime'

/** Deterministic stub embedder: maps known texts to fixed vectors. */
const embedStub =
  (vectors: Record<string, number[]>): EmbedFn =>
  async (texts) =>
    texts.map((text) => {
      const vector = vectors[text]
      if (vector === undefined) throw new Error(`no stub vector for '${text}'`)
      return vector
    })

describe('scorers.embeddingSimilarity', () => {
  it('scores the cosine similarity between output and expected embeddings', async () => {
    const embed = embedStub({ north: [0, 1], 'north-east': [1, 1] })
    const scorer = scorers.embeddingSimilarity({ embed })
    const score = await scorer({ input: {}, output: 'north', expected: 'north-east' })
    expect(score.name).toBe('embeddingSimilarity')
    expect(score.score).toBeCloseTo(Math.SQRT1_2, 10)
  })

    it('identical texts score 1, orthogonal texts score 0', async () => {
    const embed = embedStub({ a: [3, 0], b: [0, 2] })
    const scorer = scorers.embeddingSimilarity({ embed })
    expect((await scorer({ input: {}, output: 'a', expected: 'a' })).score).toBeCloseTo(1, 10)
    expect((await scorer({ input: {}, output: 'a', expected: 'b' })).score).toBeCloseTo(0, 10)
  })

    it('returns null without an expected payload', async () => {
    const scorer = scorers.embeddingSimilarity({ embed: embedStub({}) })
    expect((await scorer({ input: {}, output: 'a', expected: undefined })).score).toBeNull()
  })

    it('uses the runner embed fn through the contextual channel', async () => {
    const embed = embedStub({ a: [1, 0], b: [1, 0] })
    const score = await invokeScorer(
      scorers.embeddingSimilarity(),
      { input: {}, output: 'a', expected: 'b' },
      { embed },
    )
    expect(score.score).toBeCloseTo(1, 10)
  })

    it('throws an explicit binding error without any embed fn', async () => {
    const scorer = scorers.embeddingSimilarity()
    await expect(
      Promise.resolve(invokeScorer(scorer, { input: {}, output: 'a', expected: 'b' }, undefined)),
    ).rejects.toThrow(/embed/)
  })
})
