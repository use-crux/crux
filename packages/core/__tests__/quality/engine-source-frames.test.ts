import { describe, expect, it } from 'vitest'
import { evaluate } from '../../src/quality'
import type { QualitySourceFrameRequest, QualitySourceFrameResolver } from '../../src/quality/source-frame'
import { runEvaluationWithRunner as run } from './runner-harness'

const upperTask = async (input: { q: string }) => ({ answer: input.q.toUpperCase() })

describe('Quality runner - source frame snapshots', () => {
  it('captures authored source-frame snapshots for direct programmatic runs', async () => {
    const evaluation = evaluate({
      task: upperTask,
      data: [{ input: { q: 'x' } }],
      expect: (ctx) => {
        ctx.expect(ctx.output.answer).toBe('X')
      },
    })

    const experiment = await run(evaluation)
    const outcome = experiment.cells[0]!.assertions.outcomes?.[0]

    expect(outcome).toMatchObject({
      status: 'passed',
      subjectExpr: 'ctx.output.answer',
      sourceFrame: {
        kind: 'source-frame',
        authoredFile: expect.stringMatching(/engine-source-frames\.test\.ts$/),
        resolver: 'disk',
        stale: false,
      },
    })
    expect(outcome?.sourceFrame?.kind === 'source-frame' ? outcome.sourceFrame.lines : []).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'passed',
          text: expect.stringContaining("ctx.expect(ctx.output.answer).toBe('X')"),
        }),
      ]),
    )
  })

  it('records authored source-frame snapshots from a supplied resolver', async () => {
    const requests: QualitySourceFrameRequest[] = []
    const resolver: QualitySourceFrameResolver = {
      async resolveSourceFrame(request) {
        requests.push(request)
        return {
          kind: 'source-frame',
          sourceRef: request.sourceRef,
          authoredFile: '/project/evals/support.eval.ts',
          authoredLine: 42,
          authoredColumn: 8,
          frameStartLine: 40,
          frameEndLine: 44,
          lines: [
            { line: 40, text: 'export const support = evaluate({', role: 'context' },
            { line: 41, text: '  expect: (ctx) => {', role: 'context' },
            { line: 42, text: "    ctx.expect(ctx.output.answer).toBe('WRONG')", role: request.role },
            { line: 43, text: '  },', role: 'context' },
            { line: 44, text: '})', role: 'context' },
          ],
          contentHash: 'sha256:test-frame',
          capturedAt: request.capturedAt,
          stale: false,
          resolver: 'source-map',
        }
      },
    }
    const evaluation = evaluate({
      task: upperTask,
      data: [{ input: { q: 'x' } }],
      expect: (ctx) => {
        ctx.expect(ctx.output.answer).toBe('WRONG')
      },
    })

    const experiment = await run(evaluation, undefined, { sourceFrameResolver: resolver })
    const failed = experiment.cells[0]!.assertions.outcomes?.[0]

    expect(failed).toMatchObject({
      status: 'failed',
      subjectExpr: 'ctx.output.answer',
      sourceFrame: {
        kind: 'source-frame',
        sourceRef: expect.stringMatching(/engine-source-frames\.test\.ts:\d+:\d+$/),
        authoredFile: '/project/evals/support.eval.ts',
        authoredLine: 42,
        frameStartLine: 40,
        frameEndLine: 44,
        contentHash: 'sha256:test-frame',
        stale: false,
        resolver: 'source-map',
      },
    })
    expect(failed?.sourceFrame?.kind === 'source-frame' ? failed.sourceFrame.lines[2] : undefined).toEqual({
      line: 42,
      text: "    ctx.expect(ctx.output.answer).toBe('WRONG')",
      role: 'failed',
    })
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      role: 'failed',
      frameRadius: 4,
    })
    expect(requests[0]!.sourceRef).toMatch(/engine-source-frames\.test\.ts:\d+:\d+$/)
  })

  it('records source-frame snapshots for expect callback errors', async () => {
    const requests: QualitySourceFrameRequest[] = []
    const resolver: QualitySourceFrameResolver = {
      async resolveSourceFrame(request) {
        requests.push(request)
        return {
          kind: 'source-frame',
          sourceRef: request.sourceRef,
          authoredFile: '/project/evals/runtime-error.eval.ts',
          authoredLine: 12,
          authoredColumn: 4,
          frameStartLine: 10,
          frameEndLine: 14,
          lines: [
            { line: 10, text: '  expect: (ctx) => {', role: 'context' },
            { line: 11, text: '    verifyOutput(ctx.output)', role: 'context' },
            { line: 12, text: "    throw new Error('plain callback crash')", role: request.role },
            { line: 13, text: '  },', role: 'context' },
            { line: 14, text: '})', role: 'context' },
          ],
          contentHash: 'sha256:callback-error-frame',
          capturedAt: request.capturedAt,
          stale: false,
          resolver: 'source-map',
        }
      },
    }
    const evaluation = evaluate({
      task: upperTask,
      data: [{ input: { q: 'x' } }],
      expect: () => {
        throw new Error('plain callback crash')
      },
    })

    const experiment = await run(evaluation, undefined, { sourceFrameResolver: resolver })
    const cell = experiment.cells[0]!

    expect(cell.status).toBe('errored')
    expect(cell.assertions.outcomes).toEqual([])
    expect(cell.error).toMatchObject({
      message: 'plain callback crash',
      phase: 'expect',
      sourceRef: expect.stringMatching(/engine-source-frames\.test\.ts:\d+:\d+$/),
      sourceFrame: {
        kind: 'source-frame',
        authoredFile: '/project/evals/runtime-error.eval.ts',
        authoredLine: 12,
        resolver: 'source-map',
      },
    })
    expect(cell.error?.sourceFrame?.kind === 'source-frame' ? cell.error.sourceFrame.lines[2]?.role : undefined).toBe(
      'failed',
    )
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ role: 'failed', frameRadius: 4 })
  })
})
