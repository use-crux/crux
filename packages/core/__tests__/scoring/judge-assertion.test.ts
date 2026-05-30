import { describe, it, expect } from 'vitest'
import { judgeAssertion } from '../../testing'
import { llmJudge } from '../../scoring/judge'
import type { GenerateObjectFn } from '../../compaction/types'

function mockGenerateWith(score: number): GenerateObjectFn {
  return (async () => ({
    object: { reasoning: 'test', score },
  })) as unknown as GenerateObjectFn
}

describe('judgeAssertion', () => {
  it('returns true when score meets minScore', async () => {
    const judge = llmJudge({
      id: 'test',
      criteria: 'test',
      scale: { min: 1, max: 5 },
      generate: mockGenerateWith(4),
      model: 'test',
    })

    const assert = judgeAssertion(judge, { minScore: 4 })
    const result = await assert({ text: 'some output' })
    expect(result).toBe(true)
  })

  it('returns true when score exceeds minScore', async () => {
    const judge = llmJudge({
      id: 'test',
      criteria: 'test',
      scale: { min: 1, max: 5 },
      generate: mockGenerateWith(5),
      model: 'test',
    })

    const assert = judgeAssertion(judge, { minScore: 3 })
    const result = await assert({ text: 'great output' })
    expect(result).toBe(true)
  })

  it('returns false when score is below minScore', async () => {
    const judge = llmJudge({
      id: 'test',
      criteria: 'test',
      scale: { min: 1, max: 5 },
      generate: mockGenerateWith(2),
      model: 'test',
    })

    const assert = judgeAssertion(judge, { minScore: 3 })
    const result = await assert({ text: 'poor output' })
    expect(result).toBe(false)
  })

  it('uses result.text as the output to score', async () => {
    let capturedPrompt = ''
    const generate: GenerateObjectFn = (async (opts: any) => {
      capturedPrompt = opts.prompt ?? ''
      return { object: { reasoning: 'ok', score: 3 } }
    }) as unknown as GenerateObjectFn

    const judge = llmJudge({
      id: 'test',
      criteria: 'test',
      scale: { min: 1, max: 5 },
      generate,
      model: 'test',
    })

    const assert = judgeAssertion(judge, { minScore: 1 })
    await assert({ text: 'the actual output text' })
    expect(capturedPrompt).toContain('the actual output text')
  })

  it('returns a reusable assertion function', async () => {
    const judge = llmJudge({
      id: 'test',
      criteria: 'test',
      scale: { min: 1, max: 5 },
      generate: mockGenerateWith(4),
      model: 'test',
    })

    const assert = judgeAssertion(judge, { minScore: 3 })

    // Call multiple times
    expect(await assert({ text: 'output 1' })).toBe(true)
    expect(await assert({ text: 'output 2' })).toBe(true)
  })
})
