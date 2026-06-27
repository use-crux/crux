import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as runnerCore from '@use-crux/core/quality/internal/runner'
import { collectEvaluationFiles } from './quality-collect'
import { executeEvaluations, type QualityRunEvent } from './quality-execute'
import { promoteExperiment } from './quality-promote'

const FIXTURE_ROOT = resolve(__dirname, '__fixtures__/quality-collect')

async function runOnce(options: { include: string; dir: string; cases?: readonly string[] }) {
  const collected = await collectEvaluationFiles({ rootDir: FIXTURE_ROOT, include: options.include })
  expect(collected.errors).toEqual([])
  const events: QualityRunEvent[] = []
  await executeEvaluations({
    core: runnerCore,
    collected: collected.evaluations,
    ...(options.cases !== undefined ? { cases: options.cases } : {}),
    engine: { qualityId: 'promote-test', rootDir: FIXTURE_ROOT, dir: options.dir, persist: true },
    emit: (event) => events.push(event),
  })
  const evalDone = events.find((event) => event.type === 'eval:done')
  if (evalDone?.type !== 'eval:done') throw new Error('expected eval:done')
  return { collected: collected.evaluations, evalDone }
}

async function promote(options: {
  dir: string
  experimentId: string
  collected: Awaited<ReturnType<typeof collectEvaluationFiles>>['evaluations']
  variant?: string
  pinId?: string
}) {
  const events: QualityRunEvent[] = []
  const result = await promoteExperiment({
    core: runnerCore,
    collected: options.collected,
    dir: options.dir,
    rootDir: FIXTURE_ROOT,
    experimentId: options.experimentId,
    ...(options.variant !== undefined ? { variant: options.variant } : {}),
    ...(options.pinId !== undefined ? { pinId: options.pinId } : {}),
    emit: (event) => events.push(event),
  })
  return { events, exitCode: result.exitCode }
}

describe('promoteExperiment — the worker behind `crux quality promote`', () => {
  it('promotes an explicit-id experiment and writes the committed baseline', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'quality-promote-'))
    const { collected, evalDone } = await runOnce({ include: 'promote/explicit-id.eval.ts', dir })

    const { events, exitCode } = await promote({ dir, experimentId: evalDone.experimentId, collected })
    expect(exitCode).toBe(0)
    const done = events.find((event) => event.type === 'promote:done')
    if (done?.type !== 'promote:done') throw new Error('expected promote:done')
    expect(done.experimentId).toBe(evalDone.experimentId)
    expect(done.baselineId).toMatch(/^[0-9A-Z]{26}$/)

    const record = JSON.parse(readFileSync(done.path, 'utf8')) as { evaluationId: string; reference: object }
    expect(record.evaluationId).toBe(done.evaluationId)
    expect(Object.keys(record.reference).length).toBeGreaterThan(0)
  })

  it('refuses a path-derived id without --pin-id, printing the pin guidance', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'quality-promote-'))
    const { collected, evalDone } = await runOnce({ include: 'evals/greeting.eval.ts', dir })

    const { events, exitCode } = await promote({ dir, experimentId: evalDone.experimentId, collected })
    expect(exitCode).toBe(2)
    const error = events.find((event) => event.type === 'error')
    if (error?.type !== 'error') throw new Error('expected error')
    expect(error.message).toContain('--pin-id')
  })

  it('promotes a path-derived id under the pinned id and returns the pin hint', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'quality-promote-'))
    const { collected, evalDone } = await runOnce({ include: 'evals/greeting.eval.ts', dir })

    const { events, exitCode } = await promote({
      dir,
      experimentId: evalDone.experimentId,
      collected,
      pinId: 'greeting.pinned',
    })
    expect(exitCode).toBe(0)
    const done = events.find((event) => event.type === 'promote:done')
    if (done?.type !== 'promote:done') throw new Error('expected promote:done')
    expect(done.evaluationId).toBe('greeting.pinned')
    expect(done.pinHint).toContain("evaluate('greeting.pinned'")
  })

  it('refuses to promote a filtered run', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'quality-promote-'))
    const { collected, evalDone } = await runOnce({ include: 'evals/greeting.eval.ts', dir, cases: ['hello*'] })

    const { events, exitCode } = await promote({
      dir,
      experimentId: evalDone.experimentId,
      collected,
      pinId: 'greeting.pinned',
    })
    expect(exitCode).toBe(2)
    const error = events.find((event) => event.type === 'error')
    if (error?.type !== 'error') throw new Error('expected error')
    expect(error.message).toContain('filtered')
  })

  it('an unknown experiment id is an error', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'quality-promote-'))
    const { collected } = await runOnce({ include: 'evals/greeting.eval.ts', dir })
    const { events, exitCode } = await promote({ dir, experimentId: '01JUNKNOWNEXPERIMENTID0000', collected })
    expect(exitCode).toBe(2)
    expect(events.some((event) => event.type === 'error')).toBe(true)
  })
})
