import { describe, expect, it } from 'vitest'
import { evaluate } from '../../quality'
import type { Scorer } from '../../quality/scorers'
import type { QualitySourceFrameRequest, QualitySourceFrameResolver } from '../../quality/source-frame'
import { runEvaluationWithRunner as run } from './runner-harness'

const answerTask = async (input: { q: string }) => ({ answer: `cited answer for ${input.q}` })

const citationValidScorer = Object.assign(() => ({ name: 'citation_valid', score: 0.58 }), {
  scorerName: 'citation_valid' as const,
  costClass: 'code' as const,
}) satisfies Scorer<{ q: string }, { answer: string }, unknown, 'citation_valid'>

describe('Quality runner - score-aware assertions', () => {
  it('runs post-score assertions with typed scores and records threshold evidence', async () => {
    const requests: QualitySourceFrameRequest[] = []
    const resolver: QualitySourceFrameResolver = {
      async resolveSourceFrame(request) {
        requests.push(request)
        return {
          kind: 'source-frame',
          sourceRef: request.sourceRef,
          authoredFile: '/project/evals/citations.eval.ts',
          authoredLine: 31,
          authoredColumn: 8,
          frameStartLine: 29,
          frameEndLine: 33,
          lines: [
            { line: 29, text: 'export const citations = evaluate({', role: 'context' },
            { line: 30, text: '  assert: (ctx) => {', role: 'context' },
            {
              line: 31,
              text: '    ctx.expect(ctx.score.citation_valid).toBeGreaterThanOrEqual(0.7)',
              role: request.role,
            },
            { line: 32, text: '  },', role: 'context' },
            { line: 33, text: '})', role: 'context' },
          ],
          contentHash: 'sha256:score-assertion',
          capturedAt: request.capturedAt,
          stale: false,
          resolver: 'source-map',
        }
      },
    }
    const evaluation = evaluate({
      task: answerTask,
      data: [{ input: { q: 'refunds' } }],
      scorers: [citationValidScorer],
      assert: (ctx) => {
        ctx.expect(ctx.score.citation_valid).toBeGreaterThanOrEqual(0.7)
      },
    })

    const experiment = await run(evaluation, undefined, { sourceFrameResolver: resolver })
    const cell = experiment.perCase[0]!
    const failed = cell.assertions.outcomes?.[0]

    expect(cell.status).toBe('failed')
    expect(cell.scores).toEqual(
      expect.arrayContaining([
        { name: 'citation_valid', score: 0.58, costClass: 'code' },
        { name: 'pass', score: 0 },
      ]),
    )
    expect(failed).toMatchObject({
      id: 'assert:evaluation:0',
      level: 'evaluation',
      phase: 'assert',
      index: 0,
      status: 'failed',
      matcher: 'toBeGreaterThanOrEqual',
      actual: { label: 'actual', value: 0.58, preview: '0.58', redacted: false },
      expected: { label: 'expected', value: 0.7, preview: '0.7', redacted: false },
      expression: {
        operator: '>=',
        result: false,
        rendered: '0.58 >= 0.7 => false',
      },
      sourceFrame: {
        kind: 'source-frame',
        authoredFile: '/project/evals/citations.eval.ts',
        authoredLine: 31,
        contentHash: 'sha256:score-assertion',
        stale: false,
      },
    })
    expect(failed?.expression?.left.value).toBe(0.58)
    expect(failed?.expression?.right?.value).toBe(0.7)
    expect(failed?.sourceFrame?.kind === 'source-frame' ? failed.sourceFrame.lines[2]?.role : undefined).toBe('failed')
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ role: 'failed', frameRadius: 4 })
  })

  it('keeps expect pre-score semantics and runs case-level asserts after scorers', async () => {
    const order: string[] = []
    let scorerCalls = 0
    const evaluation = evaluate({
      task: answerTask,
      data: [
        {
          input: { q: 'refunds' },
          assert: (ctx) => {
            order.push(`case-assert:${scorerCalls}`)
            ctx.expect(ctx.score.citation_valid).toBeGreaterThanOrEqual(0.5)
          },
        },
      ],
      expect: (ctx) => {
        order.push(`expect:${scorerCalls}`)
        ctx.score('answer-length', Math.min(1, ctx.output.answer.length / 100))
        ctx.expect(ctx.output.answer).toContain('refunds')
      },
      scorers: [
        Object.assign(
          () => {
            scorerCalls += 1
            order.push('scorer')
            return { name: 'citation_valid', score: 0.91 }
          },
          { scorerName: 'citation_valid' as const, costClass: 'code' as const },
        ),
      ],
      assert: (ctx) => {
        order.push(`evaluation-assert:${scorerCalls}`)
        ctx.expect(ctx.score.citation_valid).toBeGreaterThanOrEqual(0.9)
        ctx.expect(ctx.scores.map((score) => score.name)).toContain('answer-length')
      },
    })

    const experiment = await run(evaluation)
    const cell = experiment.perCase[0]!

    expect(cell.status).toBe('passed')
    expect(order).toEqual(['expect:0', 'scorer', 'evaluation-assert:1', 'case-assert:1'])
    expect(cell.scores).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'answer-length', score: 0.24 }),
        expect.objectContaining({ name: 'citation_valid', score: 0.91, costClass: 'code' }),
        expect.objectContaining({ name: 'pass', score: 1 }),
      ]),
    )
    expect(
      cell.assertions.outcomes?.map(({ level, phase, status, matcher }) => ({ level, phase, status, matcher })),
    ).toEqual([
      { level: 'evaluation', phase: 'expect', status: 'passed', matcher: 'toContain' },
      { level: 'evaluation', phase: 'assert', status: 'passed', matcher: 'toBeGreaterThanOrEqual' },
      { level: 'evaluation', phase: 'assert', status: 'passed', matcher: 'toContain' },
      { level: 'case', phase: 'assert', status: 'passed', matcher: 'toBeGreaterThanOrEqual' },
    ])
  })
})
