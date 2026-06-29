import { describe, it, expect } from 'vitest'
import { metrics } from '../../scoring/metrics'
import type { GenerateObjectFn } from '../../compaction/types'

const mockGenerate: GenerateObjectFn = (async () => ({
  object: { reasoning: 'Test reasoning', score: 4 },
})) as unknown as GenerateObjectFn

const defaults = { generate: mockGenerate, model: 'test-model' }

describe('metrics', () => {
  it('relevance creates a judge with id "relevance"', () => {
    const judge = metrics.relevance(defaults)
    expect(judge.id).toBe('relevance')
  })

    it('faithfulness creates a judge with id "faithfulness"', () => {
    const judge = metrics.faithfulness(defaults)
    expect(judge.id).toBe('faithfulness')
  })

    it('coherence creates a judge with id "coherence"', () => {
    const judge = metrics.coherence(defaults)
    expect(judge.id).toBe('coherence')
  })

    it('completeness creates a judge with id "completeness"', () => {
    const judge = metrics.completeness(defaults)
    expect(judge.id).toBe('completeness')
  })

    it('toxicity creates a judge with id "toxicity"', () => {
    const judge = metrics.toxicity(defaults)
    expect(judge.id).toBe('toxicity')
  })

    it('conciseness creates a judge with id "conciseness"', () => {
    const judge = metrics.conciseness(defaults)
    expect(judge.id).toBe('conciseness')
  })

    it('all metrics return valid JudgeInstance objects', () => {
    const metricNames = ['relevance', 'faithfulness', 'coherence', 'completeness', 'toxicity', 'conciseness'] as const
    for (const name of metricNames) {
      const judge = metrics[name](defaults)
      expect(judge.id).toBe(name)
      expect(typeof judge.score).toBe('function')
    }
  })

    it('metric judges can score', async () => {
    const judge = metrics.relevance(defaults)
    const result = await judge.score({ input: 'query', output: 'response' })

    expect(result.score).toBe(4)
    expect(result.reasoning).toBe('Test reasoning')
    expect(result.metricId).toBe('relevance')
  })

    it('metric judges pass model through', async () => {
    let capturedModel: unknown
    const gen: GenerateObjectFn = (async (opts: any) => {
      capturedModel = opts.model
      return { object: { reasoning: 'ok', score: 3 } }
    }) as unknown as GenerateObjectFn

    const judge = metrics.coherence({ generate: gen, model: 'my-judge-model' })
    await judge.score({ input: 'q', output: 'a' })

    expect(capturedModel).toBe('my-judge-model')
  })
})
