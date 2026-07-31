import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { judge as createJudge } from '../../src/scoring/judge'
import type { GenerateObjectFn } from '../../src/generation/support-types'

/** Mock generate that returns a fixed score and reasoning. */
function mockGenerateWith(score: number, reasoning = 'Test reasoning'): GenerateObjectFn {
  return (async () => ({
    object: { reasoning, score },
  })) as unknown as GenerateObjectFn
}

describe('judge', () => {
  it('creates a judge with the correct id', () => {
    const judge = createJudge({
      id: 'test-judge',
      criteria: 'Is the output good?',
      scale: { min: 1, max: 5 },
      generate: mockGenerateWith(4),
      model: 'test-model',
    })

    expect(judge.id).toBe('test-judge')
  })

  it('score() returns JudgeResult with metricId', async () => {
    const judge = createJudge({
      id: 'relevance',
      criteria: 'Is the output relevant?',
      scale: { min: 1, max: 5 },
      generate: mockGenerateWith(4, 'Relevant response'),
      model: 'test-model',
    })

    const result = await judge.score({ input: 'question', output: 'answer' })
    expect(result.score).toBe(4)
    expect(result.reasoning).toBe('Relevant response')
    expect(result.metricId).toBe('relevance')
  })

    it('score() exposes routed judge cost for cascade report accounting', async () => {
    const generate: GenerateObjectFn = async () => ({
      object: { reasoning: 'Costed response', score: 4 },
      routing: { model: 'judge-model', cost: 0.007, trace: [] },
    })
    const judge = createJudge({
      id: 'costed',
      criteria: 'Is the output relevant?',
      scale: { min: 1, max: 5 },
      generate,
      model: 'judge-model',
    })

    const result = await judge.score({ input: 'question', output: 'answer' })

    expect(result.cost).toBe(0.007)
  })

    it('clamps score to scale range (above max)', async () => {
    const judge = createJudge({
      id: 'test',
      criteria: 'test',
      scale: { min: 1, max: 5 },
      generate: mockGenerateWith(8),
      model: 'test',
    })

    const result = await judge.score({ input: 'q', output: 'a' })
    expect(result.score).toBe(5)
  })

    it('clamps score to scale range (below min)', async () => {
    const judge = createJudge({
      id: 'test',
      criteria: 'test',
      scale: { min: 1, max: 5 },
      generate: mockGenerateWith(-1),
      model: 'test',
    })

    const result = await judge.score({ input: 'q', output: 'a' })
    expect(result.score).toBe(1)
  })

    it('passes criteria to system prompt', async () => {
    let capturedSystem = ''
    const generate: GenerateObjectFn = (async (opts: any) => {
      capturedSystem = opts.system ?? ''
      return { object: { reasoning: 'ok', score: 3 } }
    }) as unknown as GenerateObjectFn

    const judge = createJudge({
      id: 'test',
      criteria: 'Does the output contain actionable advice?',
      scale: { min: 1, max: 5 },
      generate,
      model: 'test',
    })

    await judge.score({ input: 'q', output: 'a' })
    expect(capturedSystem).toContain('actionable advice')
  })

    it('includes rubric in system prompt', async () => {
    let capturedSystem = ''
    const generate: GenerateObjectFn = (async (opts: any) => {
      capturedSystem = opts.system ?? ''
      return { object: { reasoning: 'ok', score: 3 } }
    }) as unknown as GenerateObjectFn

    const judge = createJudge({
      id: 'test',
      criteria: 'test',
      scale: { min: 1, max: 5 },
      rubric: {
        1: 'Terrible',
        3: 'Adequate',
        5: 'Excellent',
      },
      generate,
      model: 'test',
    })

    await judge.score({ input: 'q', output: 'a' })
    expect(capturedSystem).toContain('Terrible')
    expect(capturedSystem).toContain('Adequate')
    expect(capturedSystem).toContain('Excellent')
  })

    it('includes few-shot examples in system prompt', async () => {
    let capturedSystem = ''
    const generate: GenerateObjectFn = (async (opts: any) => {
      capturedSystem = opts.system ?? ''
      return { object: { reasoning: 'ok', score: 3 } }
    }) as unknown as GenerateObjectFn

    const judge = createJudge({
      id: 'test',
      criteria: 'test',
      scale: { min: 1, max: 5 },
      fewShot: [
        {
          input: 'What is AI?',
          output: 'AI is cool.',
          score: 2,
          reasoning: 'Too vague',
        },
      ],
      generate,
      model: 'test',
    })

    await judge.score({ input: 'q', output: 'a' })
    expect(capturedSystem).toContain('What is AI?')
    expect(capturedSystem).toContain('Too vague')
  })

    it('passes input and output in user prompt', async () => {
    let capturedPrompt = ''
    const generate: GenerateObjectFn = (async (opts: any) => {
      capturedPrompt = opts.prompt ?? ''
      return { object: { reasoning: 'ok', score: 3 } }
    }) as unknown as GenerateObjectFn

    const judge = createJudge({
      id: 'test',
      criteria: 'test',
      scale: { min: 1, max: 5 },
      generate,
      model: 'test',
    })

    await judge.score({ input: 'my question', output: 'my answer' })
    expect(capturedPrompt).toContain('my question')
    expect(capturedPrompt).toContain('my answer')
  })

    it('includes reference in user prompt when provided', async () => {
    let capturedPrompt = ''
    const generate: GenerateObjectFn = (async (opts: any) => {
      capturedPrompt = opts.prompt ?? ''
      return { object: { reasoning: 'ok', score: 3 } }
    }) as unknown as GenerateObjectFn

    const judge = createJudge({
      id: 'test',
      criteria: 'test',
      scale: { min: 1, max: 5 },
      generate,
      model: 'test',
    })

    await judge.score({ input: 'q', output: 'a', reference: 'gold standard' })
    expect(capturedPrompt).toContain('gold standard')
    expect(capturedPrompt).toContain('Reference')
  })

    it('allows overriding model at score time', async () => {
    let capturedModel: unknown
    const generate: GenerateObjectFn = (async (opts: any) => {
      capturedModel = opts.model
      return { object: { reasoning: 'ok', score: 3 } }
    }) as unknown as GenerateObjectFn

    const judge = createJudge({
      id: 'test',
      criteria: 'test',
      scale: { min: 1, max: 5 },
      generate,
      model: 'default-model',
    })

    await judge.score({ input: 'q', output: 'a' }, { model: 'override-model' })
    expect(capturedModel).toBe('override-model')
  })

    it('allows overriding generate at score time', async () => {
    let called = false
    const overrideGenerate: GenerateObjectFn = (async () => {
      called = true
      return { object: { reasoning: 'ok', score: 3 } }
    }) as unknown as GenerateObjectFn

    const judge = createJudge({
      id: 'test',
      criteria: 'test',
      scale: { min: 1, max: 5 },
      generate: mockGenerateWith(5),
      model: 'test',
    })

    await judge.score({ input: 'q', output: 'a' }, { generate: overrideGenerate })
    expect(called).toBe(true)
  })

    it('throws if no generate function provided', async () => {
    const judge = createJudge({
      id: 'test',
      criteria: 'test',
      scale: { min: 1, max: 5 },
      model: 'test',
    })

    await expect(judge.score({ input: 'q', output: 'a' })).rejects.toThrow('no generate function')
  })

    it('throws if no model provided', async () => {
    const judge = createJudge({
      id: 'test',
      criteria: 'test',
      scale: { min: 1, max: 5 },
      generate: mockGenerateWith(3),
    })

    await expect(judge.score({ input: 'q', output: 'a' })).rejects.toThrow('no model provided')
  })

    it('includes context in system prompt when provided', async () => {
    let capturedSystem = ''
    const generate: GenerateObjectFn = (async (opts: any) => {
      capturedSystem = opts.system ?? ''
      return { object: { reasoning: 'ok', score: 3 } }
    }) as unknown as GenerateObjectFn

    const judge = createJudge({
      id: 'test',
      criteria: 'Evaluate brand alignment',
      scale: { min: 1, max: 5 },
      context: 'Brand voice: professional, concise. Audience: B2B executives.',
      generate,
      model: 'test',
    })

    await judge.score({ input: 'q', output: 'a' })
    expect(capturedSystem).toContain('## Context')
    expect(capturedSystem).toContain('Brand voice: professional')
    expect(capturedSystem).toContain('B2B executives')
  })

    it('omits context section when not provided', async () => {
    let capturedSystem = ''
    const generate: GenerateObjectFn = (async (opts: any) => {
      capturedSystem = opts.system ?? ''
      return { object: { reasoning: 'ok', score: 3 } }
    }) as unknown as GenerateObjectFn

    const judge = createJudge({
      id: 'test',
      criteria: 'test',
      scale: { min: 1, max: 5 },
      generate,
      model: 'test',
    })

    await judge.score({ input: 'q', output: 'a' })
    expect(capturedSystem).not.toContain('## Context')
  })

describe('detailSchema', () => {
    it('returns detail when detailSchema is configured', async () => {
      const generate: GenerateObjectFn = (async () => ({
        object: {
          reasoning: 'Well aligned',
          score: 4,
          detail: { notes: ['Good tone', 'Matches audience'] },
        },
      })) as unknown as GenerateObjectFn

      const judge = createJudge({
        id: 'brand-alignment',
        criteria: 'Evaluate brand alignment',
        scale: { min: 1, max: 5 },
        detailSchema: z.object({ notes: z.array(z.string()) }),
        generate,
        model: 'test',
      })

      const result = await judge.score({
        input: 'brand check',
        output: 'content',
      })
      expect(result.score).toBe(4)
      expect(result.detail).toEqual({
        notes: ['Good tone', 'Matches audience'],
      })
    })

    it('does not include detail when detailSchema is not configured', async () => {
      const judge = createJudge({
        id: 'test',
        criteria: 'test',
        scale: { min: 1, max: 5 },
        generate: mockGenerateWith(3),
        model: 'test',
      })

      const result = await judge.score({ input: 'q', output: 'a' })
      expect(result.detail).toBeUndefined()
    })

    it('passes detailSchema to generate as merged output schema', async () => {
      let capturedSchema: any
      const generate: GenerateObjectFn = (async (opts: any) => {
        capturedSchema = opts.schema
        return {
          object: {
            reasoning: 'ok',
            score: 4,
            detail: { aligned: true, issues: [] },
          },
        }
      }) as unknown as GenerateObjectFn

      const judge = createJudge({
        id: 'plan-judge',
        criteria: 'test',
        scale: { min: 1, max: 5 },
        detailSchema: z.object({
          aligned: z.boolean(),
          issues: z.array(z.string()),
        }),
        generate,
        model: 'test',
      })

      await judge.score({ input: 'q', output: 'a' })
      // Schema should have reasoning, score, AND detail
      const shape = capturedSchema.shape
      expect(shape.reasoning).toBeDefined()
      expect(shape.score).toBeDefined()
      expect(shape.detail).toBeDefined()
    })

    it('mentions detail in system prompt when detailSchema is configured', async () => {
      let capturedSystem = ''
      const generate: GenerateObjectFn = (async (opts: any) => {
        capturedSystem = opts.system ?? ''
        return { object: { reasoning: 'ok', score: 3, detail: { notes: [] } } }
      }) as unknown as GenerateObjectFn

      const judge = createJudge({
        id: 'test',
        criteria: 'test',
        scale: { min: 1, max: 5 },
        detailSchema: z.object({ notes: z.array(z.string()) }),
        generate,
        model: 'test',
      })

      await judge.score({ input: 'q', output: 'a' })
      expect(capturedSystem).toContain('detail')
    })
  })
})
