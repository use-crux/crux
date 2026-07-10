import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { observe } from '../../src/observability'
import { evaluate } from '../../src/quality'
import { createQualityRunner, type QualityRunnerEvent } from '../../src/quality/internal/runner'

const upperTask = async (input: { q: string }) => ({
  answer: input.q.toUpperCase(),
})

describe('createQualityRunner — boundary facade', () => {
  it('collects exported evaluations and runs them without exposing engine definitions', async () => {
    const evaluation = evaluate('runner.smoke', {
      task: upperTask,
      data: [{ name: 'hello', input: { q: 'hi' } }],
    })
    const events: QualityRunnerEvent[] = []
    const runner = createQualityRunner({
      persist: false,
      qualityId: 'runner-test',
      events: (event) => events.push(event),
    })

    const collected = await runner.collect({
      modules: [{ file: 'inline.eval.ts', exports: { evaluation } }],
    })
    expect(collected.errors).toEqual([])
    expect(collected.evaluations).toHaveLength(1)
    expect(collected.evaluations[0]).toMatchObject({
      id: 'runner.smoke',
      explicitId: true,
      file: 'inline.eval.ts',
      exportName: 'evaluation',
      source: 'file',
    })
    expect(collected.evaluations[0]!.manifest.id).toBe('runner.smoke')

    const result = await runner.run({ evaluations: collected.evaluations })
    expect(result.exitCode).toBe(0)
    expect(result.experiments).toHaveLength(1)
    expect(result.experiments[0]!.evaluationId).toBe('runner.smoke')
    expect(result.experiments[0]!.passed).toBe(true)
    expect(events.map((event) => event.type)).toEqual([
      'collect:done',
      'eval:start',
      'cell:start',
      'cell:done',
      'eval:done',
      'run:done',
    ])
  })

  it('promotes a persisted experiment through the facade', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'crux-runner-facade-'))
    const evaluation = evaluate('runner.promote', {
      task: upperTask,
      data: [{ input: { q: 'ok' } }],
    })
    const runner = createQualityRunner({
      dir,
      rootDir: process.cwd(),
      persist: true,
      qualityId: 'runner-test',
    })
    const collected = await runner.collect({
      modules: [{ file: 'inline.eval.ts', exports: { evaluation } }],
    })
    expect(collected.errors).toEqual([])
    const run = await runner.run({ evaluations: collected.evaluations })

    const promoted = await runner.promote({
      evaluations: collected.evaluations,
      experimentId: run.experiments[0]!.experimentId,
    })

    expect(promoted.exitCode).toBe(0)
    expect(promoted.baseline?.evaluationId).toBe('runner.promote')
    expect(promoted.baseline?.baselineId).toMatch(/^[0-9A-Z]{26}$/)
    const record = JSON.parse(readFileSync(promoted.baseline!.path, 'utf8')) as { evaluationId: string }
    expect(record.evaluationId).toBe('runner.promote')
  })

  it('round-trips feedback records through the facade with filters', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'crux-runner-feedback-'))
    const runner = createQualityRunner({ dir, qualityId: 'runner-test' })

    const record = await runner.feedback.add({
      experimentId: 'exp-1',
      caseId: 'case-1',
      rating: 1,
      tags: ['human-label'],
      metadata: { variant: 'default', trial: 0, scoreName: 'quality' },
      comment: 'looks correct',
    })
    expect(record).toMatchObject({
      _tag: 'QualityFeedback',
      qualityId: 'runner-test',
      experimentId: 'exp-1',
      caseId: 'case-1',
      rating: 1,
    })

    await runner.feedback.add({
      experimentId: 'exp-2',
      caseId: 'case-2',
      tags: ['other'],
    })

    const labels = await runner.feedback.list({
      experimentId: 'exp-1',
      caseId: 'case-1',
      tags: ['human-label'],
    })

    expect(labels).toEqual([record])
  })

  it('compares two experiment records through the facade', async () => {
    const runner = createQualityRunner({ qualityId: 'runner-test' })
    const base = {
      schemaVersion: 2,
      evaluationId: 'runner.compare',
      qualityId: 'test',
      startedAt: '2026-07-08T00:00:00.000Z',
      endedAt: '2026-07-08T00:00:01.000Z',
      configFingerprint: 'same',
      taskFingerprint: 'task',
      filteredRun: false,
      replay: { mode: 'live' },
      variants: [{ name: 'default', overrideKeys: [] }],
      aggregates: { perVariant: {} },
      gates: { passed: true, informational: false, results: [] },
      passed: true,
    } as const

    const diff = await runner.compare({
      a: {
        ...base,
        experimentId: '01KTRUNNERA',
        cells: [runnerCompareCell('case-1', 1, true)],
      },
      b: {
        ...base,
        experimentId: '01KTRUNNERB',
        gates: { passed: false, informational: false, results: [] },
        passed: false,
        cells: [runnerCompareCell('case-1', 0.25, false)],
      },
    })

    expect(diff).toMatchObject({
      schemaVersion: 1,
      a: { experimentId: '01KTRUNNERA' },
      b: { experimentId: '01KTRUNNERB' },
      gatesVerdict: { aPassed: true, bPassed: false },
    })
    expect(diff.scores.find((score) => score.name === 'quality')?.delta).toBe(-0.75)
  })

  it('emits run completion when setup resolution fails', async () => {
    const evaluation = evaluate('runner.setup-failure', {
      task: upperTask,
      data: [{ input: { q: 'hi' } }],
    })
    const events: QualityRunnerEvent[] = []
    const runner = createQualityRunner({
      persist: false,
      setup: async () => {
        throw new Error('setup unavailable')
      },
      events: (event) => events.push(event),
    })
    const collected = await runner.collect({ modules: [{ file: 'inline.eval.ts', exports: { evaluation } }] })

    const result = await runner.run({ evaluations: collected.evaluations })

    expect(result).toMatchObject({ exitCode: 1, experimentIds: [], experiments: [] })
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'error',
          scope: 'execute',
          message: expect.stringContaining('setup unavailable') as string,
        }),
        { type: 'run:done', experiments: [], exitCode: 1 },
      ]),
    )
  })

  it('rejects a manifest baseline that was not run by the experiment', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'crux-runner-facade-'))
    const experimentId = 'unrun-baseline'
    mkdirSync(join(dir, 'experiments'), { recursive: true })
    writeFileSync(
      join(dir, 'experiments', `${experimentId}.json`),
      `${JSON.stringify({
        evaluationId: 'runner.unrun-baseline',
        configFingerprint: 'fingerprint',
        filteredRun: false,
        variants: [{ name: 'candidate' }, { name: 'cheap' }],
        cases: [],
      })}\n`,
      'utf8',
    )
    const evaluation = evaluate('runner.unrun-baseline', {
      task: upperTask,
      data: [{ input: { q: 'ok' } }],
      variants: { current: {}, candidate: {}, cheap: {} },
      baseline: 'current',
    })
    const events: QualityRunnerEvent[] = []
    const runner = createQualityRunner({ dir, events: (event) => events.push(event) })
    const collected = await runner.collect({ modules: [{ file: 'inline.eval.ts', exports: { evaluation } }] })

    const promoted = await runner.promote({ evaluations: collected.evaluations, experimentId })

    expect(promoted).toEqual({ exitCode: 2 })
    expect(events).toContainEqual({
      type: 'error',
      scope: 'promote',
      message: "unknown variant 'current' — this experiment ran: candidate, cheap.",
    })
  })

  it('reruns only failed cells from the latest experiment for the selected evaluation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'crux-runner-failed-'))
    const evaluation = evaluate('runner.failed-rerun', {
      task: upperTask,
      data: [
        { name: 'good case', input: { q: 'ok' } },
        { name: 'bad case', input: { q: 'bad' } },
      ],
      expect: (ctx) => {
        ctx.expect(ctx.output.answer).toBe('OK')
      },
    })
    const runner = createQualityRunner({ dir, persist: true })
    const collected = await runner.collect({ modules: [{ file: 'inline.eval.ts', exports: { evaluation } }] })

    const firstRun = await runner.run({ evaluations: collected.evaluations })
    expect(firstRun.exitCode).toBe(1)

    const events: QualityRunnerEvent[] = []
    const rerun = createQualityRunner({ dir, persist: false, events: (event) => events.push(event) })
    const secondRun = await rerun.run({
      evaluations: collected.evaluations,
      ids: ['runner.failed-rerun'],
      failed: 'latest',
    })

    expect(secondRun.exitCode).toBe(0)
    expect(secondRun.experiments[0]!.filteredRun).toBe(true)
    expect(secondRun.experiments[0]!.gates.informational).toBe(true)
    expect(secondRun.experiments[0]!.cells.map((cell) => cell.caseId)).toEqual(['bad-case'])
    expect(events.filter((event) => event.type === 'cell:done')).toHaveLength(1)
  })

  it('samples a deterministic case subset when given an explicit seed', async () => {
    const evaluation = evaluate('runner.sample', {
      task: upperTask,
      data: [
        { name: 'alpha', input: { q: 'a' } },
        { name: 'bravo', input: { q: 'b' } },
        { name: 'charlie', input: { q: 'c' } },
        { name: 'delta', input: { q: 'd' } },
        { name: 'echo', input: { q: 'e' } },
      ],
    })
    const runner = createQualityRunner({ persist: false })
    const collected = await runner.collect({ modules: [{ file: 'inline.eval.ts', exports: { evaluation } }] })

    const first = await runner.run({
      evaluations: collected.evaluations,
      sample: { size: 2, seed: 'stable' },
    })
    const second = await runner.run({
      evaluations: collected.evaluations,
      sample: { size: 2, seed: 'stable' },
    })

    expect(first.experiments[0]!.cells).toHaveLength(2)
    expect(first.experiments[0]!.filteredRun).toBe(true)
    expect(first.experiments[0]!.gates.informational).toBe(true)
    expect(first.experiments[0]!.cells.map((cell) => cell.caseId)).toEqual(
      second.experiments[0]!.cells.map((cell) => cell.caseId),
    )
  })

  it('stops scheduling new cells once max cost is reached and skips the remainder', async () => {
    const evaluation = evaluate('runner.max-cost', {
      task: async (input: { q: string }) => {
        await observe.span({ name: 'costed call', primitive: 'generation.call' }, async () => {
          observe.event({ name: 'usage.observed', attributes: { costUsd: 0.002 } })
        })
        return upperTask(input)
      },
      data: [
        { name: 'first', input: { q: 'a' } },
        { name: 'second', input: { q: 'b' } },
        { name: 'third', input: { q: 'c' } },
      ],
    })
    const runner = createQualityRunner({ persist: false })
    const collected = await runner.collect({ modules: [{ file: 'inline.eval.ts', exports: { evaluation } }] })

    const result = await runner.run({
      evaluations: collected.evaluations,
      maxCostUsd: 0.001,
    })

    const experiment = result.experiments[0]!
    expect(result.exitCode).toBe(0)
    expect(experiment.filteredRun).toBe(true)
    expect(experiment.gates.informational).toBe(true)
    expect(experiment.cells.map((cell) => cell.status)).toEqual(['passed', 'skipped', 'skipped'])
    expect(experiment.cells.slice(1).map((cell) => cell.skipReason)).toEqual(['budget', 'budget'])
  })
})

function runnerCompareCell(caseId: string, score: number, passed: boolean) {
  return {
    caseId,
    variantName: 'default',
    trial: 0,
    status: passed ? 'passed' : 'failed',
    input: { id: caseId },
    output: { score },
    scores: [
      { name: 'quality', score, costClass: 'code' },
      { name: 'pass', score: passed ? 1 : 0, costClass: 'code' },
    ],
    assertions: { ran: 1, notEvaluated: 0, outcomes: [] },
    durationMs: 1,
    traceIds: [],
    capturedSignals: [],
  } as const
}
