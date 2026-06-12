import { describe, expect, it } from 'vitest'
import { setObservabilityTransport } from '../../observability/observe'
import { evaluate, scorers } from '../../quality'
import { getEvaluationDefinition, type Evaluation } from '../../quality/evaluate'
import { runEvaluation } from '../../quality/internal/engine'
import type { RunOverrides } from '../../quality/experiment'

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

const upperTask = async (input: { q: string }) => input.q.toUpperCase()

describe('runEvaluation — cell event callbacks (runner stream)', () => {
  it('fires onCellStart and onCellDone for every executed cell, start before done', async () => {
    const evaluation = evaluate('events.basic', {
      task: upperTask,
      data: [{ name: 'one', input: { q: 'a' } }, { name: 'two', input: { q: 'b' } }],
    })
    const events: string[] = []
    const experiment = await run(evaluation, undefined, {
      events: {
        onCellStart: (cell) => events.push(`start:${cell.caseId}:${cell.variantName}:${cell.trial}`),
        onCellDone: (cell) => events.push(`done:${cell.caseId}:${cell.status}`),
      },
    })

    expect(events).toHaveLength(4)
    for (const cell of experiment.perCase) {
      const startIndex = events.indexOf(`start:${cell.caseId}:default:0`)
      const doneIndex = events.indexOf(`done:${cell.caseId}:passed`)
      expect(startIndex).toBeGreaterThanOrEqual(0)
      expect(doneIndex).toBeGreaterThan(startIndex)
    }
  })

  it('emits onCellDone (without onCellStart) for skipped cells', async () => {
    const evaluation = evaluate('events.skip', {
      task: upperTask,
      data: [{ name: 'live', input: { q: 'a' } }, { name: 'later', input: { q: 'b' }, skip: 'flaky' }],
    })
    const started: string[] = []
    const done: string[] = []
    await run(evaluation, undefined, {
      events: {
        onCellStart: (cell) => started.push(cell.caseId),
        onCellDone: (cell) => done.push(`${cell.caseId}:${cell.status}`),
      },
    })

    expect(started).toHaveLength(1)
    expect(done).toHaveLength(2)
    expect(done.some((entry) => entry.endsWith(':skipped'))).toBe(true)
  })

  it('passes the trial index on multi-trial cells', async () => {
    const evaluation = evaluate('events.trials', {
      task: upperTask,
      data: [{ name: 'tri', input: { q: 'a' } }],
      trials: 3,
    })
    const trials: number[] = []
    await run(evaluation, undefined, {
      events: { onCellStart: (cell) => trials.push(cell.trial) },
    })

    expect(trials.sort()).toEqual([0, 1, 2])
  })
})

describe('runEvaluation — config defaults channel (quality.defaults)', () => {
  it('applies defaults.trials when the evaluation does not declare trials', async () => {
    const evaluation = evaluate('defaults.trials', {
      task: upperTask,
      data: [{ input: { q: 'a' } }],
    })
    const experiment = await run(evaluation, undefined, { defaults: { trials: 3 } })

    expect(experiment.perCase).toHaveLength(3)
  })

  it('declared trials win over defaults.trials', async () => {
    const evaluation = evaluate('defaults.trials-declared', {
      task: upperTask,
      data: [{ input: { q: 'a' } }],
      trials: 2,
    })
    const experiment = await run(evaluation, undefined, { defaults: { trials: 5 } })

    expect(experiment.perCase).toHaveLength(2)
  })

  it('applies defaults.timeoutMs when the evaluation does not declare a timeout', async () => {
    const evaluation = evaluate('defaults.timeout', {
      task: async () => new Promise((resolveOutput) => setTimeout(() => resolveOutput('late'), 250)),
      data: [{ input: { q: 'a' } }],
    })
    const experiment = await run(evaluation, undefined, { defaults: { timeoutMs: 10 } })

    expect(experiment.perCase[0]!.status).toBe('errored')
    expect(experiment.perCase[0]!.error?.phase).toBe('timeout')
  })
})

describe('runEvaluation — capture settling must not hold cells hostage', () => {
  it('a hanging project transport neither inflates cell durations nor stalls the run (Karyla dogfood regression)', async () => {
    // A previously configured transport whose deliveries never resolve —
    // e.g. a devtools forwarder pointed at a dead server.
    const restore = setObservabilityTransport({
      send: () => new Promise<void>(() => {}),
    })
    try {
      const evaluation = evaluate('events.hanging-transport', {
        task: upperTask,
        data: [{ input: { q: 'a' } }, { input: { q: 'b' } }],
      })
      const startedAt = Date.now()
      const experiment = await run(evaluation)
      const wallMs = Date.now() - startedAt

      // Forwarding QoS is not the runner's job: the capture tee receives
      // records synchronously at dispatch; settle must give up quickly.
      expect(wallMs).toBeLessThan(2_000)
      for (const cell of experiment.perCase) {
        expect(cell.status).toBe('passed')
        // Task latency, not capture plumbing.
        expect(cell.durationMs).toBeLessThan(1_000)
        expect(cell.traceIds).toHaveLength(1)
      }
    } finally {
      restore()
    }
  }, 15_000)
})

describe('runEvaluation — forced filtered-run demotion (evaluate.only / CLI id filters)', () => {
  it('forceFilteredRun marks the record filtered and demotes gates to informational', async () => {
    const failing = evaluate('events.forced', {
      task: upperTask,
      data: [{ input: { q: 'a' }, expected: 'never' }],
      scorers: [scorers.exact()],
      gates: { scores: { exact: { min: 1 } } },
    })
    const experiment = await run(failing, undefined, { forceFilteredRun: true })

    expect(experiment.filteredRun).toBe(true)
    expect(experiment.gates.informational).toBe(true)
    // Informational gates never fail the run; no cells errored.
    expect(experiment.gates.passed).toBe(true)
    expect(experiment.passed).toBe(true)
  })

  it('forceFilteredRun still fails the run when a cell errored', async () => {
    const erroring = evaluate('events.forced-error', {
      task: async () => {
        throw new Error('boom')
      },
      data: [{ input: { q: 'a' } }],
    })
    const experiment = await run(erroring, undefined, { forceFilteredRun: true })

    expect(experiment.filteredRun).toBe(true)
    expect(experiment.gates.passed).toBe(false)
    expect(experiment.passed).toBe(false)
  })
})
