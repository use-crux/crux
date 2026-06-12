import { describe, expect, it } from 'vitest'
import { evaluate } from '../../quality/api'
import { getEvaluationDefinition, type Evaluation } from '../../quality/evaluate'
import { runEvaluation, QualityDefinitionError } from '../../quality/internal/engine'
import type { RunOverrides } from '../../quality/experiment'
import { NotImplementedError } from '../../quality/internal/errors'

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

describe('runEvaluation — plain fn task end-to-end', () => {
  it('produces the full Experiment record shape for a passing run', async () => {
    const evaluation = evaluate('engine.smoke', {
      task: upperTask,
      data: [{ input: { q: 'hi' } }, { name: 'second', input: { q: 'yo' }, expected: { answer: 'YO' } }],
    })
    const experiment = await run(evaluation)

    expect(experiment.schemaVersion).toBe(1)
    expect(experiment.experimentId).toMatch(/^[0-9A-Z]{26}$/)
    expect(experiment.evaluationId).toBe('engine.smoke')
    expect(experiment.qualityId).toBe('test')
    expect(experiment.filteredRun).toBe(false)
    expect(experiment.replay).toEqual({ mode: 'live' })
    expect(experiment.variants).toEqual([{ name: 'default', overrideKeys: [] }])
    expect(experiment.configFingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(experiment.taskFingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(Date.parse(experiment.startedAt)).not.toBeNaN()
    expect(Date.parse(experiment.endedAt)).not.toBeNaN()

    expect(experiment.perCase).toHaveLength(2)
    const first = experiment.perCase[0]!
    expect(first).toMatchObject({
      variantName: 'default',
      trial: 0,
      status: 'passed',
      input: { q: 'hi' },
      output: { answer: 'HI' },
      assertions: { ran: 0, notEvaluated: 0, failures: [] },
    })
    expect(first.caseId).toMatch(/^[0-9a-f]{12}$/)
    expect(first.traceIds).toHaveLength(1)
    expect(first.scores).toEqual([{ name: 'pass', score: 1 }])
    expect(first.durationMs).toBeGreaterThanOrEqual(0)

    const second = experiment.perCase[1]!
    expect(second.caseName).toBe('second')
    expect(second.expected).toEqual({ answer: 'YO' })

    const aggregate = experiment.aggregates.perVariant.default!
    expect(aggregate).toMatchObject({ cells: 2, passed: 2, failed: 0, errored: 0, skipped: 0, passRate: 1 })
    expect(aggregate.scores.pass).toEqual({ mean: 1, sem: 0, n: 2 })
    expect(aggregate.consistency).toBeUndefined()
    expect(aggregate.latency.p95Ms).toBeGreaterThanOrEqual(aggregate.latency.meanMs > 0 ? 0 : 0)

    expect(experiment.gates).toEqual({
      passed: true,
      informational: false,
      results: [{ gate: 'default.assertions', threshold: true, actual: true, passed: true }],
    })
    expect(experiment.passed).toBe(true)
  })

  it('runs evaluation-level expect for every case and lowers failures into the pass score', async () => {
    const evaluation = evaluate({
      task: upperTask,
      data: [{ input: { q: 'good' } }, { input: { q: 'bad' } }],
      expect: (ctx) => {
        ctx.expect(ctx.output.answer).toBe('GOOD')
      },
      scorers: [({ output }) => ({ name: 'length', score: (output as { answer: string }).answer.length > 2 ? 1 : 0 })],
    })
    const experiment = await run(evaluation)

    const good = experiment.perCase.find((cell) => (cell.input as { q: string }).q === 'good')!
    const bad = experiment.perCase.find((cell) => (cell.input as { q: string }).q === 'bad')!

    expect(good.status).toBe('passed')
    expect(good.scores).toContainEqual({ name: 'pass', score: 1 })

    expect(bad.status).toBe('failed')
    expect(bad.assertions.ran).toBe(1)
    expect(bad.assertions.failures).toHaveLength(1)
    expect(bad.assertions.failures[0]).toMatchObject({ level: 'evaluation', index: 0, matcher: 'toBe', soft: false })
    expect(bad.assertions.failures[0]!.message).toContain('BAD')
    expect(bad.assertions.failures[0]!.sourceRef).toMatch(/engine\.test\.ts:\d+:\d+$/)
    // Scorers still run on expect-failed cells (semantics rule 4).
    expect(bad.scores).toContainEqual({ name: 'length', score: 1 })
    expect(bad.scores).toContainEqual({ name: 'pass', score: 0 })

    expect(experiment.gates.passed).toBe(false)
    expect(experiment.passed).toBe(false)
  })

  it('records assertion position: a hard failure stops the callback and counts notEvaluated', async () => {
    const evaluation = evaluate({
      task: upperTask,
      data: [{ input: { q: 'x' } }],
      expect: (ctx) => {
        ctx.expect(ctx.output.answer).toBe('X') // 1 — passes
        ctx.expect(ctx.output.answer).toBe('WRONG') // 2 — hard fail, aborts
        ctx.expect(ctx.output.answer).toBeDefined() // 3 — never evaluated
        ctx.expect(ctx.output.answer).toHaveLength(1) // 4 — never evaluated
      },
    })
    const experiment = await run(evaluation)
    const cell = experiment.perCase[0]!
    expect(cell.status).toBe('failed')
    expect(cell.assertions.ran).toBe(2)
    expect(cell.assertions.notEvaluated).toBe(2)
    expect(cell.assertions.failures).toHaveLength(1)
  })

  it('expect.soft records the failure and continues the callback', async () => {
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
  })

  it('runs evaluation-level and case-level expect callbacks independently', async () => {
    const evaluation = evaluate({
      task: upperTask,
      data: [
        {
          input: { q: 'x' },
          expect: (ctx) => {
            ctx.expect(ctx.output.answer).toBe('WRONG-CASE')
          },
        },
      ],
      expect: (ctx) => {
        ctx.expect(ctx.output.answer).toBe('WRONG-EVAL')
      },
    })
    const experiment = await run(evaluation)
    const cell = experiment.perCase[0]!
    // The evaluation-level hard failure does not prevent the case-level callback.
    expect(cell.assertions.failures.map((failure) => failure.level)).toEqual(['evaluation', 'case'])
  })

  it('marks task-thrown cells errored with phase execute (false-safe gates)', async () => {
    const evaluation = evaluate({
      task: async (_input: { q: string }) => {
        throw new Error('boom')
      },
      data: [{ input: { q: 'x' } }],
      scorers: [() => ({ name: 'never', score: 1 })],
    })
    const experiment = await run(evaluation)
    const cell = experiment.perCase[0]!
    expect(cell.status).toBe('errored')
    expect(cell.error).toEqual({ message: 'boom', phase: 'execute' })
    expect(cell.output).toBeUndefined()
    // Errored cells get no scorer scores, only the lowered pass=0.
    expect(cell.scores).toEqual([{ name: 'pass', score: 0 }])
    expect(experiment.gates.passed).toBe(false)
    expect(experiment.passed).toBe(false)
  })

  it('treats non-assertion expect callback crashes as errored cells (phase expect)', async () => {
    const evaluation = evaluate({
      task: upperTask,
      data: [{ input: { q: 'x' } }],
      expect: () => {
        throw new TypeError('user bug')
      },
    })
    const experiment = await run(evaluation)
    const cell = experiment.perCase[0]!
    expect(cell.status).toBe('errored')
    expect(cell.error).toMatchObject({ message: 'user bug', phase: 'expect' })
  })

  it('records ctx.score values alongside scorer scores', async () => {
    const evaluation = evaluate({
      task: upperTask,
      data: [{ input: { q: 'hello' } }],
      expect: (ctx) => {
        ctx.score('answer-length', Math.min(1, ctx.output.answer.length / 10), { chars: ctx.output.answer.length })
      },
    })
    const experiment = await run(evaluation)
    const cell = experiment.perCase[0]!
    expect(cell.scores).toContainEqual({ name: 'answer-length', score: 0.5, metadata: { chars: 5 } })
    expect(experiment.aggregates.perVariant.default!.scores['answer-length']).toEqual({ mean: 0.5, sem: 0, n: 1 })
  })

  it('a throwing scorer marks the cell errored with phase score', async () => {
    const evaluation = evaluate({
      task: upperTask,
      data: [{ input: { q: 'x' } }],
      scorers: [
        () => {
          throw new Error('judge offline')
        },
      ],
    })
    const experiment = await run(evaluation)
    const cell = experiment.perCase[0]!
    expect(cell.status).toBe('errored')
    expect(cell.error).toMatchObject({ phase: 'score' })
    expect(cell.error!.message).toContain('judge offline')
  })
})

describe('runEvaluation — trials, skip/only, filters, timeouts', () => {
  it('fans out trials per cell and aggregates pass@k / pass^k', async () => {
    let calls = 0
    const evaluation = evaluate({
      task: async (_input: { q: string }) => {
        calls += 1
        return { flaky: calls % 2 === 0 }
      },
      data: [{ name: 'flaky', input: { q: 'a' } }],
      trials: 4,
      expect: (ctx) => {
        ctx.expect(ctx.output.flaky).toBe(true)
      },
      concurrency: 1,
    })
    const experiment = await run(evaluation)
    expect(experiment.perCase).toHaveLength(4)
    expect(experiment.perCase.map((cell) => cell.trial)).toEqual([0, 1, 2, 3])
    const aggregate = experiment.aggregates.perVariant.default!
    expect(aggregate.consistency).toEqual({ passAtK: 1, passAllTrials: 0 })
  })

  it('per-case trials win over the evaluation default', async () => {
    const evaluation = evaluate({
      task: upperTask,
      data: [
        { name: 'thrice', input: { q: 'a' }, trials: 3 },
        { name: 'once', input: { q: 'b' } },
      ],
    })
    const experiment = await run(evaluation)
    expect(experiment.perCase.filter((cell) => cell.caseName === 'thrice')).toHaveLength(3)
    expect(experiment.perCase.filter((cell) => cell.caseName === 'once')).toHaveLength(1)
  })

  it('respects the concurrency bound', async () => {
    let active = 0
    let peak = 0
    const evaluation = evaluate({
      task: async (_input: { q: string }) => {
        active += 1
        peak = Math.max(peak, active)
        await new Promise((resolve) => setTimeout(resolve, 10))
        active -= 1
        return {}
      },
      data: [{ input: { q: 'a' } }, { input: { q: 'b' } }, { input: { q: 'c' } }, { input: { q: 'd' } }],
      concurrency: 2,
    })
    await run(evaluation)
    expect(peak).toBeLessThanOrEqual(2)
    expect(peak).toBeGreaterThan(1)
  })

  it('times out slow cells with phase timeout', async () => {
    const evaluation = evaluate({
      task: async (_input: { q: string }) => {
        await new Promise((resolve) => setTimeout(resolve, 5_000))
        return {}
      },
      data: [{ input: { q: 'slow' } }],
      timeoutMs: 50,
    })
    const experiment = await run(evaluation)
    const cell = experiment.perCase[0]!
    expect(cell.status).toBe('errored')
    expect(cell.error).toMatchObject({ phase: 'timeout' })
  })

  it('reports skipped cases with their reason and excludes them from passRate', async () => {
    const evaluation = evaluate({
      task: upperTask,
      data: [
        { input: { q: 'run' } },
        { name: 'flaky upstream', input: { q: 'skip' }, skip: 'broken fixture' },
      ],
    })
    const experiment = await run(evaluation)
    expect(experiment.perCase).toHaveLength(2)
    const skipped = experiment.perCase.find((cell) => cell.status === 'skipped')!
    expect(skipped.skipReason).toBe('broken fixture')
    expect(skipped.scores).toEqual([])
    const aggregate = experiment.aggregates.perVariant.default!
    expect(aggregate).toMatchObject({ cells: 2, skipped: 1, passRate: 1 })
  })

  it('evaluate.skip skips every cell', async () => {
    const evaluation = evaluate.skip({ task: upperTask, data: [{ input: { q: 'x' } }] })
    const experiment = await run(evaluation)
    expect(experiment.perCase.every((cell) => cell.status === 'skipped')).toBe(true)
  })

  it('case-level only filters the run and demotes gates to informational', async () => {
    const evaluation = evaluate({
      task: upperTask,
      data: [
        { name: 'focus', input: { q: 'a' }, only: true },
        { name: 'other', input: { q: 'b' } },
      ],
      expect: (ctx) => {
        ctx.expect(ctx.output.answer).toBe('NEVER-RIGHT') // fails — but the run is filtered
      },
    })
    const experiment = await run(evaluation)
    expect(experiment.filteredRun).toBe(true)
    expect(experiment.perCase).toHaveLength(1)
    expect(experiment.perCase[0]!.caseName).toBe('focus')
    expect(experiment.gates.informational).toBe(true)
    // Informational gates never fail a filtered run without errored cells.
    expect(experiment.gates.passed).toBe(true)
  })

  it('RunOverrides.cases filters by name, id, and glob', async () => {
    const evaluation = evaluate({
      task: upperTask,
      data: [
        { name: 'smoke en', input: { q: 'a' } },
        { name: 'smoke nl', input: { q: 'b' } },
        { name: 'deep', input: { q: 'c' } },
      ],
    })
    const experiment = await run(evaluation, { cases: ['smoke*'] })
    expect(experiment.filteredRun).toBe(true)
    expect(experiment.perCase.map((cell) => cell.caseName).sort()).toEqual(['smoke en', 'smoke nl'])
  })

  it('aborts remaining cells when the signal fires', async () => {
    const controller = new AbortController()
    controller.abort()
    const evaluation = evaluate({ task: upperTask, data: [{ input: { q: 'x' } }] })
    const experiment = await run(evaluation, { signal: controller.signal })
    expect(experiment.perCase[0]!.status).toBe('skipped')
    expect(experiment.perCase[0]!.skipReason).toBe('aborted')
  })
})

describe('runEvaluation — phase boundaries', () => {
  const fnCases = [{ input: { q: 'x' } }]

  it('non-live replay is phase 5', async () => {
    const evaluation = evaluate({ task: upperTask, data: fnCases, replay: 'replay-strict' })
    await expect(run(evaluation)).rejects.toThrowError(NotImplementedError)
    await expect(run(evaluation)).rejects.toThrowError(/phase 5/)
  })

  it('promote() on a derived-id experiment rejects with the id pin guidance', async () => {
    const evaluation = evaluate({ task: upperTask, data: fnCases })
    const experiment = await run(evaluation)
    await expect(experiment.promote()).rejects.toThrowError(/explicit evaluation id/)
  })

  it('multi-turn cases error with a clear message', async () => {
    const flowTask = (await import('../../flow/scope')).flow<{ ok: boolean }, { topic: string }>(
      'turny',
      async () => ({ ok: true }),
    )
    const evaluation = evaluate({
      task: flowTask,
      data: [{ turns: [{ user: 'hi' }, { user: 'more' }] }],
    })
    const experiment = await run(evaluation)
    const cell = experiment.perCase[0]!
    expect(cell.status).toBe('errored')
    expect(cell.error!.message).toContain('multi-turn')
  })
})

describe('runEvaluation — declared gates', () => {
  it('evaluates passRate and score gates against aggregates', async () => {
    const evaluation = evaluate({
      task: upperTask,
      data: [{ input: { q: 'aa' } }, { input: { q: 'b' } }],
      scorers: [
        Object.assign(
          ({ input }: { input: unknown; output: unknown; expected: unknown }) => ({
            name: 'long',
            score: (input as { q: string }).q.length > 1 ? 1 : 0,
          }),
          { scorerName: 'long' as const },
        ),
      ],
      gates: { passRate: { min: 1 }, scores: { long: { min: 0.75 } } },
    })
    const experiment = await run(evaluation)
    expect(experiment.gates.results).toEqual([
      { gate: 'passRate.min', threshold: 1, actual: 1, passed: true },
      { gate: 'scores.long.min', threshold: 0.75, actual: 0.5, passed: false },
    ])
    expect(experiment.gates.passed).toBe(false)
    // Default assertion policy is REPLACED by declared gates: no expect
    // failures occurred, but the score gate still reds the run.
    expect(experiment.passed).toBe(false)
  })

  it('minDeltaVsBaseline with no baseline yet is informational, never blocking', async () => {
    const evaluation = evaluate({
      task: upperTask,
      data: [{ input: { q: 'x' } }],
      gates: { scores: { pass: { minDeltaVsBaseline: -0.02 } } },
    })
    const experiment = await run(evaluation)
    expect(experiment.gates.results).toEqual([
      {
        gate: 'scores.pass.minDeltaVsBaseline',
        threshold: -0.02,
        actual: 0,
        passed: false,
        informational: true,
      },
    ])
    // The unevaluable delta gate is reported but does not red the run.
    expect(experiment.gates.passed).toBe(true)
    expect(experiment.passed).toBe(true)
  })
})

describe('runEvaluation — definition errors', () => {
  it('a prompt task without a generate fn is a definition error', async () => {
    const { prompt } = await import('../../define')
    const { z } = await import('zod')
    const supportPrompt = prompt({
      id: 'support',
      input: z.object({ question: z.string() }),
      output: z.object({ answer: z.string() }),
      system: 'answer',
    })
    const evaluation = evaluate({ task: supportPrompt, data: [{ input: { question: 'q' } }] })
    await expect(run(evaluation)).rejects.toThrowError(QualityDefinitionError)
    await expect(run(evaluation)).rejects.toThrowError(/generate/)
  })
})
