import { describe, it, expect, vi, afterEach } from 'vitest'
import { z } from 'zod'
import { evaluateContext } from '../../testing'
import { prompt as makePrompt } from '../../define'
import { context } from '../../context'
import { llmJudge } from '../../scoring/judge'
import { updateRuntime, resetRuntime } from '../../runtime'
import type { GenerateObjectFn } from '../../compaction/types'
import type { GenerateFn } from '../../testing'

describe('evaluateContext', () => {
  const brandContext = context({
    id: 'brand',
    system: 'Use a professional tone.',
  })

  const styleContext = context({
    id: 'style',
    system: 'Write concisely.',
  })

  const prompt = makePrompt({
    id: 'test-prompt',
    input: z.object({ topic: z.string() }),
    use: [brandContext, styleContext],
    system: ({ input }) => `Write about ${input.topic}.`,
  })

  it('returns improved when with-context scores higher', async () => {
    let callCount = 0
    const mockGenerate: GenerateFn = async () => {
      callCount++
      // First call: with contexts → better output
      // Second call: without contexts → worse output
      return { text: callCount <= 1 ? 'Professional output' : 'Basic output' }
    }

    // Judge scores professional higher
    let scoreCount = 0
    const judgeGenerate: GenerateObjectFn = (async () => {
      scoreCount++
      return {
        object: {
          reasoning: 'test',
          score: scoreCount <= 1 ? 5 : 3,
        },
      }
    }) as unknown as GenerateObjectFn

    const judge = llmJudge({
      id: 'quality',
      criteria: 'test',
      scale: { min: 1, max: 5 },
      generate: judgeGenerate,
      model: 'test',
    })

    const report = await evaluateContext({
      prompt,
      generate: mockGenerate,
      model: 'test',
      judge,
      cases: [
        {
          name: 'brand-helps',
          input: { topic: 'AI' },
          contexts: [brandContext],
        },
      ],
    })

    expect(report.results).toHaveLength(1)
    expect(report.results[0].improved).toBe(true)
    expect(report.results[0].delta).toBe(2)
    expect(report.summary.improved).toBe(1)
  })

  it('returns degraded when without-context scores higher', async () => {
    let callCount = 0
    const mockGenerate: GenerateFn = async () => {
      callCount++
      return { text: `output ${callCount}` }
    }

    let scoreCount = 0
    const judgeGenerate: GenerateObjectFn = (async () => {
      scoreCount++
      return {
        object: {
          reasoning: 'test',
          score: scoreCount <= 1 ? 2 : 4,
        },
      }
    }) as unknown as GenerateObjectFn

    const judge = llmJudge({
      id: 'quality',
      criteria: 'test',
      scale: { min: 1, max: 5 },
      generate: judgeGenerate,
      model: 'test',
    })

    const report = await evaluateContext({
      prompt,
      generate: mockGenerate,
      model: 'test',
      judge,
      cases: [
        {
          name: 'context-hurts',
          input: { topic: 'AI' },
          contexts: [brandContext],
        },
      ],
    })

    expect(report.results[0].improved).toBe(false)
    expect(report.results[0].delta).toBe(-2)
    expect(report.summary.degraded).toBe(1)
  })

  it('handles multiple cases', async () => {
    const mockGenerate: GenerateFn = async () => ({ text: 'output' })

    const judgeGenerate: GenerateObjectFn = (async () => ({
      object: { reasoning: 'test', score: 3 },
    })) as unknown as GenerateObjectFn

    const judge = llmJudge({
      id: 'quality',
      criteria: 'test',
      scale: { min: 1, max: 5 },
      generate: judgeGenerate,
      model: 'test',
    })

    const report = await evaluateContext({
      prompt,
      generate: mockGenerate,
      model: 'test',
      judge,
      cases: [
        { name: 'case-1', input: { topic: 'AI' }, contexts: [brandContext] },
        { name: 'case-2', input: { topic: 'ML' }, contexts: [styleContext] },
      ],
    })

    expect(report.results).toHaveLength(2)
    expect(report.summary.total).toBe(2)
    expect(report.summary.neutral).toBe(2)
  })

  describe('reporter integration', () => {
    afterEach(() => {
      resetRuntime()
    })

    it('fires reporter onStart, onCase, and onEnd', async () => {
      const onStart = vi.fn()
      const onCase = vi.fn()
      const onEnd = vi.fn()
      updateRuntime({ evalReporter: { onStart, onCase, onEnd } })

      const mockGenerate: GenerateFn = async () => ({ text: 'output' })
      const judgeGenerate: GenerateObjectFn = (async () => ({
        object: { reasoning: 'test', score: 4 },
      })) as unknown as GenerateObjectFn

      const judge = llmJudge({
        id: 'quality',
        criteria: 'test',
        scale: { min: 1, max: 5 },
        generate: judgeGenerate,
        model: 'test',
      })

      await evaluateContext({
        prompt,
        generate: mockGenerate,
        model: 'test',
        judge,
        cases: [{ name: 'case-a', input: { topic: 'AI' }, contexts: [brandContext] }],
      })

      expect(onStart).toHaveBeenCalledOnce()
      expect(onStart.mock.calls[0][0]).toMatchObject({
        promptId: 'test-prompt',
        models: ['test'],
        caseNames: ['case-a'],
        totalCases: 1,
      })
      expect(onStart.mock.calls[0][0].evalId).toMatch(/^eval-/)

      expect(onCase).toHaveBeenCalledOnce()
      expect(onCase.mock.calls[0][0]).toMatchObject({
        caseName: 'case-a',
        modelId: 'test',
        completedCount: 1,
      })

      expect(onEnd).toHaveBeenCalledOnce()
      expect(onEnd.mock.calls[0][0].summary).toMatchObject({ total: 1 })
    })

    it('threads evalId to judge.score() calls', async () => {
      const judgeResults = vi.fn()
      updateRuntime({ instrumentationHooks: { onJudgeResult: judgeResults } })

      const mockGenerate: GenerateFn = async () => ({ text: 'output' })
      const judgeGenerate: GenerateObjectFn = (async () => ({
        object: { reasoning: 'test', score: 4 },
      })) as unknown as GenerateObjectFn

      const judge = llmJudge({
        id: 'quality',
        criteria: 'test',
        scale: { min: 1, max: 5 },
        generate: judgeGenerate,
        model: 'test',
      })

      await evaluateContext({
        prompt,
        generate: mockGenerate,
        model: 'test',
        judge,
        cases: [{ name: 'case-a', input: { topic: 'AI' }, contexts: [brandContext] }],
      })

      // Two judge calls per case (with and without context)
      expect(judgeResults).toHaveBeenCalledTimes(2)
      const evalId = judgeResults.mock.calls[0][0].evalId
      expect(evalId).toMatch(/^eval-/)
      // Both calls share the same evalId
      expect(judgeResults.mock.calls[1][0].evalId).toBe(evalId)
    })
  })
})