import { describe, it, expect, vi, afterEach } from 'vitest'
import { evaluateCompaction } from '../../testing'
import { updateRuntime, resetRuntime } from '../../runtime'
import type { Message } from '../../messages'
import type { GenerateObjectFn } from '../../compaction/types'

const originalMessages: Message[] = [
  { role: 'user', content: 'What are the key features of React?' },
  {
    role: 'assistant',
    content: 'React has components, virtual DOM, hooks, and JSX.',
  },
  { role: 'user', content: 'Tell me more about hooks.' },
  {
    role: 'assistant',
    content: 'Hooks like useState and useEffect manage state and side effects.',
  },
]

const compactedMessages: Message[] = [
  {
    role: 'system',
    content:
      'Summary: User asked about React features (components, virtual DOM, hooks, JSX) and hooks details (useState, useEffect).',
  },
  { role: 'user', content: 'Tell me more about hooks.' },
  {
    role: 'assistant',
    content: 'Hooks like useState and useEffect manage state and side effects.',
  },
]

describe('evaluateCompaction', () => {
  it('returns a fidelity score', async () => {
    const generate: GenerateObjectFn = (async () => ({
      object: { reasoning: 'All key facts preserved', score: 5 },
    })) as unknown as GenerateObjectFn

    const report = await evaluateCompaction({
      original: originalMessages,
      compacted: compactedMessages,
      generate,
      model: 'test',
    })

    expect(report.score).toBe(5)
    expect(report.reasoning).toBeTruthy()
  })

  it('evaluates against default criteria', async () => {
    let callCount = 0
    const generate: GenerateObjectFn = (async () => {
      callCount++
      return {
        object: { reasoning: `Criterion ${callCount} evaluation`, score: 4 },
      }
    }) as unknown as GenerateObjectFn

    const report = await evaluateCompaction({
      original: originalMessages,
      compacted: compactedMessages,
      generate,
      model: 'test',
    })

    // Default has 3 criteria
    expect(report.criteria).toHaveLength(3)
    expect(callCount).toBe(3)
  })

  it('evaluates against custom criteria', async () => {
    let callCount = 0
    const generate: GenerateObjectFn = (async () => {
      callCount++
      return { object: { reasoning: 'ok', score: 4 } }
    }) as unknown as GenerateObjectFn

    const report = await evaluateCompaction({
      original: originalMessages,
      compacted: compactedMessages,
      generate,
      model: 'test',
      criteria: ['decisions preserved', 'tone maintained'],
    })

    expect(report.criteria).toHaveLength(2)
    expect(report.criteria[0].criterion).toBe('decisions preserved')
    expect(report.criteria[1].criterion).toBe('tone maintained')
    expect(callCount).toBe(2)
  })

  it('averages scores across criteria', async () => {
    let callCount = 0
    const scores = [3, 5]
    const generate: GenerateObjectFn = (async () => ({
      object: { reasoning: 'ok', score: scores[callCount++] ?? 4 },
    })) as unknown as GenerateObjectFn

    const report = await evaluateCompaction({
      original: originalMessages,
      compacted: compactedMessages,
      generate,
      model: 'test',
      criteria: ['criterion-a', 'criterion-b'],
    })

    expect(report.score).toBe(4) // avg of 3 and 5
  })

  it('includes per-criterion reasoning', async () => {
    const generate: GenerateObjectFn = (async () => ({
      object: { reasoning: 'Well preserved', score: 4 },
    })) as unknown as GenerateObjectFn

    const report = await evaluateCompaction({
      original: originalMessages,
      compacted: compactedMessages,
      generate,
      model: 'test',
      criteria: ['facts preserved'],
    })

    expect(report.criteria[0].reasoning).toBe('Well preserved')
    expect(report.criteria[0].score).toBe(4)
  })

  it('passes messages to the judge in prompt', async () => {
    let capturedPrompt = ''
    const generate: GenerateObjectFn = (async (opts: any) => {
      capturedPrompt = opts.prompt ?? ''
      return { object: { reasoning: 'ok', score: 4 } }
    }) as unknown as GenerateObjectFn

    await evaluateCompaction({
      original: originalMessages,
      compacted: compactedMessages,
      generate,
      model: 'test',
      criteria: ['facts'],
    })

    // The judge receives both original (as input) and compacted (as output)
    expect(capturedPrompt).toContain('React')
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

      const generate: GenerateObjectFn = (async () => ({
        object: { reasoning: 'ok', score: 4 },
      })) as unknown as GenerateObjectFn

      await evaluateCompaction({
        original: originalMessages,
        compacted: compactedMessages,
        generate,
        model: 'test',
        criteria: ['facts preserved', 'tone maintained'],
      })

      expect(onStart).toHaveBeenCalledOnce()
      expect(onStart.mock.calls[0][0]).toMatchObject({
        promptId: 'compaction-fidelity',
        models: ['test'],
        caseNames: ['facts preserved', 'tone maintained'],
        totalCases: 2,
      })
      expect(onStart.mock.calls[0][0].evalId).toMatch(/^eval-/)

      expect(onCase).toHaveBeenCalledTimes(2)
      expect(onCase.mock.calls[0][0]).toMatchObject({
        caseName: 'facts preserved',
        modelId: 'test',
      })
      expect(onCase.mock.calls[1][0]).toMatchObject({
        caseName: 'tone maintained',
        modelId: 'test',
      })

      expect(onEnd).toHaveBeenCalledOnce()
      expect(onEnd.mock.calls[0][0].summary).toMatchObject({
        total: 2,
        passed: 2,
      })
    })

    it('threads evalId to judge.score() calls', async () => {
      const judgeResults = vi.fn()
      updateRuntime({ instrumentationHooks: { onJudgeResult: judgeResults } })

      const generate: GenerateObjectFn = (async () => ({
        object: { reasoning: 'ok', score: 4 },
      })) as unknown as GenerateObjectFn

      await evaluateCompaction({
        original: originalMessages,
        compacted: compactedMessages,
        generate,
        model: 'test',
        criteria: ['facts'],
      })

      expect(judgeResults).toHaveBeenCalledOnce()
      expect(judgeResults.mock.calls[0][0].evalId).toMatch(/^eval-/)
      // Judge id includes evalId for uniqueness
      expect(judgeResults.mock.calls[0][0].metricId).toContain('compaction-fidelity:')
    })
  })
})
