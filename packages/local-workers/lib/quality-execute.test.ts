import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as runnerCore from '@use-crux/core/quality/internal/runner'
import { collectEvaluationFiles } from './quality-collect'
import { executeEvaluations, type QualityRunEvent } from './quality-execute'

const FIXTURE_ROOT = resolve(__dirname, '__fixtures__/quality-collect')

async function collectAndRun(options: {
  include: string | readonly string[]
  ids?: readonly string[]
  persistDir?: string
}): Promise<{ events: QualityRunEvent[]; exitCode: number }> {
  const collected = await collectEvaluationFiles({ rootDir: FIXTURE_ROOT, include: options.include })
  expect(collected.errors).toEqual([])
  const events: QualityRunEvent[] = []
  const result = await executeEvaluations({
    core: runnerCore,
    collected: collected.evaluations,
    ids: options.ids,
    engine: {
      qualityId: 'execute-test',
      rootDir: FIXTURE_ROOT,
      ...(options.persistDir ? { dir: options.persistDir, persist: true } : { persist: false }),
    },
    emit: (event) => events.push(event),
  })
  return { events, exitCode: result.exitCode }
}

describe('executeEvaluations — event stream and exit codes', () => {
  it('emits eval:start → cell events → eval:done → run:done with exit 0 for a passing run', async () => {
    const { events, exitCode } = await collectAndRun({ include: 'evals/greeting.eval.ts' })

    expect(exitCode).toBe(0)
    const types = events.map((event) => event.type)
    expect(types[0]).toBe('eval:start')
    expect(types.at(-1)).toBe('run:done')
    expect(types.filter((type) => type === 'cell:start')).toHaveLength(2)
    expect(types.filter((type) => type === 'cell:done')).toHaveLength(2)

    const evalStart = events[0]!
    if (evalStart.type !== 'eval:start') throw new Error('expected eval:start')
    expect(evalStart.evaluationId).toBe('evals.greeting')
    expect(evalStart.cells).toBe(2)

    const evalDone = events.find((event) => event.type === 'eval:done')
    if (evalDone?.type !== 'eval:done') throw new Error('expected eval:done')
    expect(evalDone.experimentId).toMatch(/^[0-9A-Z]{26}$/)
    expect(evalDone.aggregates.perVariant['default']!.passRate).toBe(1)
    expect(evalDone.gates.passed).toBe(true)

    const runDone = events.at(-1)!
    if (runDone.type !== 'run:done') throw new Error('expected run:done')
    expect(runDone.experiments).toEqual([evalDone.experimentId])
    expect(runDone.exitCode).toBe(0)
  })

  it('exits 1 when an expect fails under the default gate policy', async () => {
    const { events, exitCode } = await collectAndRun({ include: 'failing/always-fails.eval.ts' })

    expect(exitCode).toBe(1)
    const cellDone = events.find((event) => event.type === 'cell:done')
    if (cellDone?.type !== 'cell:done') throw new Error('expected cell:done')
    expect(cellDone.cell.status).toBe('failed')
    expect(cellDone.cell.assertions.outcomes.filter((outcome) => outcome.status === 'failed')).toHaveLength(1)
  })

  it('runs only the selected ids', async () => {
    const { events, exitCode } = await collectAndRun({
      include: ['evals/greeting.eval.ts', 'failing/always-fails.eval.ts'],
      ids: ['evals.greeting'],
    })

    expect(exitCode).toBe(0)
    const startedIds = events.filter((event) => event.type === 'eval:start').map((event) => event.evaluationId)
    expect(startedIds).toEqual(['evals.greeting'])
  })

  it('exits 2 with a nearest-match suggestion for an unknown id', async () => {
    const { events, exitCode } = await collectAndRun({
      include: 'evals/greeting.eval.ts',
      ids: ['evals.greetings'],
    })

    expect(exitCode).toBe(2)
    const error = events.find((event) => event.type === 'error')
    if (error?.type !== 'error') throw new Error('expected error event')
    expect(error.scope).toBe('execute')
    expect(error.message).toContain('evals.greetings')
    expect(error.message).toContain('evals.greeting')
    expect(events.some((event) => event.type === 'eval:start')).toBe(false)
  })

  it('evaluate.only narrows the run set and demotes the record to a filtered run', async () => {
    const { events, exitCode } = await collectAndRun({ include: 'only/focused.eval.ts' })

    expect(exitCode).toBe(0)
    const startedIds = events.filter((event) => event.type === 'eval:start').map((event) => event.evaluationId)
    expect(startedIds).toEqual(['only.focused#focused'])
    const evalDone = events.find((event) => event.type === 'eval:done')
    if (evalDone?.type !== 'eval:done') throw new Error('expected eval:done')
    expect(evalDone.filteredRun).toBe(true)
    expect(evalDone.gates.informational).toBe(true)
  })

  it('a watch-style rescore rerun serves unchanged cells from the output cache (observable via the event stream)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'crux-quality-watch-'))
    const cacheDir = join(dir, 'cache')
    const collected = await collectEvaluationFiles({ rootDir: FIXTURE_ROOT, include: 'evals/greeting.eval.ts' })

    const runOnce = async (reuseOutputs: boolean) => {
      const events: QualityRunEvent[] = []
      await executeEvaluations({
        core: runnerCore,
        collected: collected.evaluations,
        ...(reuseOutputs ? { reuseOutputs: true } : {}),
        engine: { qualityId: 'watch-test', rootDir: FIXTURE_ROOT, persist: false, cacheDir },
        emit: (event) => events.push(event),
      })
      return events.filter((event) => event.type === 'cell:done')
    }

    const firstCells = await runOnce(false)
    expect(firstCells).toHaveLength(2)
    for (const event of firstCells) {
      if (event.type !== 'cell:done') continue
      expect(event.cell.metadata?.cached).toBeUndefined()
    }

    const secondCells = await runOnce(true)
    expect(secondCells).toHaveLength(2)
    for (const event of secondCells) {
      if (event.type !== 'cell:done') continue
      expect(event.cell.status).toBe('passed')
      expect(event.cell.metadata?.cached).toBe(true)
    }
  })

  it('persists the record and reports its path on eval:done', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'crux-quality-exec-'))
    const { events } = await collectAndRun({ include: 'evals/greeting.eval.ts', persistDir: dir })

    const evalDone = events.find((event) => event.type === 'eval:done')
    if (evalDone?.type !== 'eval:done') throw new Error('expected eval:done')
    expect(evalDone.recordPath).toBeDefined()
    expect(existsSync(evalDone.recordPath!)).toBe(true)
    const record = JSON.parse(readFileSync(evalDone.recordPath!, 'utf8')) as { evaluationId: string }
    expect(record.evaluationId).toBe('evals.greeting')
  })
})
