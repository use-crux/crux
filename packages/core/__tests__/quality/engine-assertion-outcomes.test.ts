import { describe, expect, it } from 'vitest'
import { evaluate } from '../../quality'
import { getEvaluationDefinition, type Evaluation } from '../../quality/evaluate'
import { runEvaluation } from '../../quality/internal/engine'
import type { ExperimentCell, RunOverrides } from '../../quality/experiment'

/** Run an evaluation through the internal engine without touching the repo. */
function run(
  evaluation: Evaluation<never, never, string, string>,
  overrides?: RunOverrides<string>,
  options?: Parameters<typeof runEvaluation>[2],
) {
  return runEvaluation(getEvaluationDefinition(evaluation), overrides, {
    persist: false,
    qualityId: 'test',
    ...options,
  })
}

const upperTask = async (input: { q: string }) => ({ answer: input.q.toUpperCase() })

describe('runEvaluation — assertion outcome ledger', () => {
  it('preserves passed, failed, and not-evaluated assertion outcomes in order', async () => {
    const evaluation = evaluate({
      task: upperTask,
      data: [{ input: { q: 'x' } }],
      expect: (ctx) => {
        ctx.expect(ctx.output.answer).toBe('X')
        ctx.expect(ctx.output.answer).toBe('WRONG')
        ctx.expect(ctx.output.answer).toBeDefined()
        ctx.expect(ctx.output.answer).toHaveLength(1)
      },
    })
    const experiment = await run(evaluation)
    const cell = experiment.perCase[0]!

    expect(cell.status).toBe('failed')
    expect(cell.assertions.ran).toBe(2)
    expect(cell.assertions.notEvaluated).toBe(2)
    expect(cell.assertions.outcomes?.map(({ level, phase, index, status, matcher, soft }) => ({
      level,
      phase,
      index,
      status,
      matcher,
      soft,
    }))).toEqual([
      { level: 'evaluation', phase: 'expect', index: 0, status: 'passed', matcher: 'toBe', soft: false },
      { level: 'evaluation', phase: 'expect', index: 1, status: 'failed', matcher: 'toBe', soft: false },
      {
        level: 'evaluation',
        phase: 'expect',
        index: 2,
        status: 'not-evaluated',
        matcher: 'toBeDefined',
        soft: false,
      },
      {
        level: 'evaluation',
        phase: 'expect',
        index: 3,
        status: 'not-evaluated',
        matcher: 'toHaveLength',
        soft: false,
      },
    ])
    expect(cell.assertions.outcomes?.[0]).toMatchObject({
      id: 'expect:evaluation:0',
      actual: { label: 'actual', value: 'X', preview: 'X', redacted: false },
      expected: { label: 'expected', value: 'X', preview: 'X', redacted: false },
    })
    expect(cell.assertions.outcomes?.[1]).toMatchObject({
      id: 'expect:evaluation:1',
      message: expect.stringContaining('WRONG'),
      actual: { label: 'actual', value: 'X', preview: 'X', redacted: false },
      expected: { label: 'expected', value: 'WRONG', preview: 'WRONG', redacted: false },
    })
    expect(cell.assertions.outcomes?.[1]!.sourceRef).toMatch(/engine-assertion-outcomes\.test\.ts:\d+:\d+$/)
    expect(cell.assertions.failures).toEqual([
      expect.objectContaining({
        level: 'evaluation',
        index: 1,
        matcher: 'toBe',
        soft: false,
        message: expect.stringContaining('WRONG'),
        actualPreview: 'X',
        expectedPreview: 'WRONG',
      }),
    ])
  })

    it('records soft failures and later passing assertions in the same ledger', async () => {
    const evaluation = evaluate({
      task: upperTask,
      data: [{ input: { q: 'x' } }],
      expect: (ctx) => {
        ctx.expect.soft(ctx.output.answer).toBe('WRONG')
        ctx.expect(ctx.output.answer).toBe('X')
      },
    })
    const experiment = await run(evaluation)
    const cell = experiment.perCase[0]!

    expect(cell.status).toBe('failed')
    expect(cell.assertions.ran).toBe(2)
    expect(cell.assertions.notEvaluated).toBe(0)
    expect(cell.assertions.failures).toEqual([
      expect.objectContaining({ matcher: 'soft.toBe', soft: true, index: 0 }),
    ])
    expect(cell.assertions.outcomes?.map(({ index, status, matcher, soft }) => ({
      index,
      status,
      matcher,
      soft,
    }))).toEqual([
      { index: 0, status: 'failed', matcher: 'soft.toBe', soft: true },
      { index: 1, status: 'passed', matcher: 'toBe', soft: false },
    ])
  })

    it('keeps old experiment cells assignable when assertion outcomes are absent', () => {
    const oldCell: ExperimentCell<{ q: string }, { answer: string }> = {
      caseId: 'legacy',
      variantName: 'default',
      trial: 0,
      status: 'failed',
      input: { q: 'x' },
      output: { answer: 'X' },
      scores: [],
      assertions: {
        ran: 1,
        notEvaluated: 0,
        failures: [
          {
            level: 'evaluation',
            index: 0,
            matcher: 'toBe',
            soft: false,
            message: 'expected X to be Y',
            actualPreview: 'X',
            expectedPreview: 'Y',
          },
        ],
      },
      durationMs: 0,
      traceIds: [],
      capturedSignals: [],
    }

    expect(oldCell.assertions.failures[0]!.matcher).toBe('toBe')
  })

    it('redacts assertion outcome values before exposing experiment cells', async () => {
    const evaluation = evaluate({
      task: async (input: { user: { email: string }; token: string }) => input,
      data: [{ input: { user: { email: 'secret@example.com' }, token: 'safe-token' } }],
      expect: (ctx) => {
        ctx.expect(ctx.output).toEqual({ user: { email: 'other@example.com' }, token: 'safe-token' })
      },
    })
    const experiment = await run(evaluation, undefined, { redact: ['user.email'] })
    const cell = experiment.perCase[0]!

    expect(cell.assertions.outcomes?.[0]).toMatchObject({
      status: 'failed',
      actual: {
        value: { user: { email: '[redacted]' }, token: 'safe-token' },
        preview: '{"token":"safe-token","user":{"email":"[redacted]"}}',
        redacted: true,
      },
      expected: {
        value: { user: { email: '[redacted]' }, token: 'safe-token' },
        preview: '{"token":"safe-token","user":{"email":"[redacted]"}}',
        redacted: true,
      },
    })
  })
})
