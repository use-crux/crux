import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { QualityRunEvent } from './quality-execute'

const require = createRequire(import.meta.url)
const TSX_CLI = require.resolve('tsx/cli')
const RUNNER = resolve(__dirname, '../bin/quality-runner.ts')
const PROJECT = resolve(__dirname, '__fixtures__/quality-project')
const CONFIG = resolve(PROJECT, 'crux.config.ts')

interface RunnerResult {
  exitCode: number
  events: QualityRunEvent[]
  stderr: string
}

function runWorker(args: string[]): Promise<RunnerResult> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [TSX_CLI, RUNNER, '--config', CONFIG, '--no-persist', ...args], {
      cwd: PROJECT,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    child.on('error', rejectRun)
    child.on('close', (code) => {
      const events = stdout
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as QualityRunEvent)
      resolveRun({ exitCode: code ?? -1, events, stderr })
    })
  })
}

describe('quality-runner worker (subprocess e2e)', () => {
  it('collects file + colocated evaluations and exits 1 when one evaluation fails', async () => {
    const { exitCode, events, stderr } = await runWorker([])

    const collectDone = events.find((event) => event.type === 'collect:done')
    if (collectDone?.type !== 'collect:done') throw new Error(`no collect:done; stderr: ${stderr}`)
    const ids = collectDone.evaluations.map((manifest) => manifest.id).sort()
    expect(ids).toEqual(['evals.failing', 'evals.passing', 'prompt:fixture.greeter'])
    expect(collectDone.errors).toEqual([])

    expect(exitCode).toBe(1)
    const evalDones = events.filter((event) => event.type === 'eval:done')
    expect(evalDones).toHaveLength(3)

    const runDone = events.at(-1)!
    if (runDone.type !== 'run:done') throw new Error('expected run:done last')
    expect(runDone.exitCode).toBe(1)
    expect(runDone.experiments).toHaveLength(3)
  }, 60_000)

  it('runs a single evaluation by id with honest (non-demoted) gates and exits 0', async () => {
    const { exitCode, events, stderr } = await runWorker(['evals.passing'])

    expect(exitCode, stderr).toBe(0)
    const evalDones = events.filter((event) => event.type === 'eval:done')
    expect(evalDones).toHaveLength(1)
    if (evalDones[0]!.type !== 'eval:done') throw new Error('expected eval:done')
    expect(evalDones[0]!.evaluationId).toBe('evals.passing')
    expect(evalDones[0]!.filteredRun).toBe(false)
    expect(evalDones[0]!.gates.informational).toBe(false)
  }, 60_000)

  it('runs the lowered prompt-tests evaluation through the config setup stub', async () => {
    const { exitCode, events, stderr } = await runWorker(['prompt:fixture.greeter'])

    expect(exitCode, stderr).toBe(0)
    const cellDones = events.filter((event) => event.type === 'cell:done')
    expect(cellDones).toHaveLength(2)
    for (const cellDone of cellDones) {
      if (cellDone.type !== 'cell:done') continue
      expect(cellDone.cell.status).toBe('passed')
      expect(cellDone.cell.output).toBe('hello from the stub')
    }
  }, 60_000)

  it('--collect-only emits manifests and executes nothing', async () => {
    const { exitCode, events } = await runWorker(['--collect-only'])

    expect(exitCode).toBe(0)
    expect(events.some((event) => event.type === 'collect:done')).toBe(true)
    expect(events.some((event) => event.type === 'eval:start')).toBe(false)
  }, 60_000)
})
