import { describe, expect, it } from 'vitest'
import { flow } from '../../flow/scope'
import { observe } from '../../observability'
import { evaluate } from '../../quality'
import { runEvaluationWithRunner as run } from './runner-harness'

describe('Quality runner - trace-backed signal span evidence', () => {
  it('records the producing span id on failed signal assertion outcomes', async () => {
    const draftFlow = flow<{ ok: boolean }, { topic: string }>('draft-check', async () => {
      try {
        await observe.span(
          {
            name: 'draft',
            family: 'flow',
            primitive: 'flow.step',
            attributes: { stepLabel: 'draft' },
          },
          async () => {
            throw new Error('draft failed')
          },
        )
      } catch {
        // Keep the task successful so the expectation phase can inspect the failed step signal.
      }
      return { ok: true }
    })

    const evaluation = evaluate({
      task: draftFlow,
      data: [{ input: { topic: 'refunds' } }],
      expect: (ctx) => {
        ctx.expect.steps.toHaveSucceeded('draft')
      },
    })

    const experiment = await run(evaluation)
    const outcome = experiment.perCase[0]!.assertions.outcomes?.[0]

    expect(experiment.perCase[0]!.status).toBe('failed')
    expect(outcome).toMatchObject({
      status: 'failed',
      matcher: 'steps.toHaveSucceeded',
    })
    expect(outcome?.spanIds).toHaveLength(1)
    expect(outcome?.spanIds?.[0]).toMatch(/^span_/)
  })
})
