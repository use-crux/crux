import { describe, expect, it } from 'vitest'
import { evaluate } from '../../quality'
import { getEvaluationDefinition, type Evaluation } from '../../quality/evaluate'
import { runEvaluation } from '../../quality/internal/engine'
import type { RunOverrides } from '../../quality/experiment'
import type { QualitySourceFrameRequest, QualitySourceFrameResolver } from '../../quality/source-frame'

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

describe('runEvaluation - source frame snapshots', () => {
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
    const failed = experiment.perCase[0]!.assertions.outcomes?.[0]

    expect(failed).toMatchObject({
      status: 'failed',
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
})
