import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { evaluate } from '../../quality'
import { createQualityRunner, type QualityRunnerEvent } from '../../quality/internal/runner'

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
})
