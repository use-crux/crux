import { describe, expect, it } from 'vitest'
import { evaluate } from '../../src/quality'
import { runEvaluationWithRunner as run } from './runner-harness'

const upperTask = async (input: { q: string }) => ({ answer: input.q.toUpperCase() })

describe('Quality runner — assertion outcome ledger', () => {
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
    const cell = experiment.cells[0]!

    expect(cell.status).toBe('failed')
    expect(cell.assertions.ran).toBe(2)
    expect(cell.assertions.notEvaluated).toBe(2)
    expect(
      cell.assertions.outcomes?.map(({ level, phase, index, status, matcher, soft }) => ({
        level,
        phase,
        index,
        status,
        matcher,
        soft,
      })),
    ).toEqual([
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
    expect(cell.assertions.outcomes.filter((outcome) => outcome.status === 'failed')).toEqual([
      expect.objectContaining({
        level: 'evaluation',
        index: 1,
        matcher: 'toBe',
        soft: false,
        message: expect.stringContaining('WRONG'),
        actual: expect.objectContaining({ preview: 'X' }),
        expected: expect.objectContaining({ preview: 'WRONG' }),
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
    const cell = experiment.cells[0]!

    expect(cell.status).toBe('failed')
    expect(cell.assertions.ran).toBe(2)
    expect(cell.assertions.notEvaluated).toBe(0)
    expect(cell.assertions.outcomes.filter((outcome) => outcome.status === 'failed')).toEqual([
      expect.objectContaining({ matcher: 'soft.toBe', soft: true, index: 0 }),
    ])
    expect(
      cell.assertions.outcomes?.map(({ index, status, matcher, soft }) => ({
        index,
        status,
        matcher,
        soft,
      })),
    ).toEqual([
      { index: 0, status: 'failed', matcher: 'soft.toBe', soft: true },
      { index: 1, status: 'passed', matcher: 'toBe', soft: false },
    ])
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
    const cell = experiment.cells[0]!

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
