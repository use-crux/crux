import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import type { QualityRunEvent } from './quality-execute'

const require = createRequire(import.meta.url)
const TSX_CLI = require.resolve('tsx/cli')
const RUNNER = resolve(__dirname, '../bin/quality-runner.ts')
const PROJECT = resolve(__dirname, '__fixtures__/quality-project')
const CONFIG = resolve(PROJECT, 'crux.config.ts')
const REPLAY_DEFAULT_CONFIG = resolve(PROJECT, 'crux.replay-default.config.ts')
const IMPLICIT_MODEL_CONFIG = resolve(PROJECT, 'crux.implicit-model.config.ts')
const MISSING_BINDING_CONFIG = resolve(PROJECT, 'crux.missing-binding.config.ts')
const NO_CONFIG_PROMPT_PROJECT = resolve(__dirname, '__fixtures__/quality-no-config-prompt-tests')
const NO_CONFIG_BROKEN_PROMPT_PROJECT = resolve(__dirname, '__fixtures__/quality-no-config-broken-prompt-tests')

interface RunnerResult {
  exitCode: number
  events: QualityRunEvent[]
  stderr: string
}

function runWorker(args: string[], options: { config?: string; env?: NodeJS.ProcessEnv } = {}): Promise<RunnerResult> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(
      process.execPath,
      [TSX_CLI, RUNNER, '--config', options.config ?? CONFIG, '--no-persist', ...args],
      {
        cwd: PROJECT,
        env: { ...process.env, ...options.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
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

function runNoConfigWorker(
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv },
): Promise<RunnerResult> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [TSX_CLI, RUNNER, '--no-persist', ...args], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
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
  it('does not source-project colocated prompt tests without crux.config.ts', async () => {
    const { exitCode, events, stderr } = await runNoConfigWorker(['--collect-only'], {
      cwd: NO_CONFIG_PROMPT_PROJECT,
    })

    expect(exitCode, stderr).toBe(0)
    const collectDone = events.find((event) => event.type === 'collect:done')
    if (collectDone?.type !== 'collect:done') throw new Error(`no collect:done; stderr: ${stderr}`)

    expect(collectDone.errors).toEqual([])
    expect(collectDone.evaluations.map((manifest) => manifest.id)).not.toContain('prompt:support.answer')
  }, 60_000)

  it('does not synthesize prompt-test dependency diagnostics without native Project Model evidence', async () => {
    const { exitCode, events, stderr } = await runNoConfigWorker(['--collect-only'], {
      cwd: NO_CONFIG_BROKEN_PROMPT_PROJECT,
    })

    expect(exitCode, stderr).toBe(0)
    const collectDone = events.find((event) => event.type === 'collect:done')
    if (collectDone?.type !== 'collect:done') throw new Error(`no collect:done; stderr: ${stderr}`)
    expect(collectDone.errors).toEqual([])
    expect(events.some((event) => event.type === 'error')).toBe(false)
  }, 60_000)

  it('collects file + colocated evaluations and runs selected file evals without ambient model setup', async () => {
    const { exitCode, events, stderr } = await runWorker(['evals.bakeoff', 'evals.failing', 'evals.passing'])

    const collectDone = events.find((event) => event.type === 'collect:done')
    if (collectDone?.type !== 'collect:done') throw new Error(`no collect:done; stderr: ${stderr}`)
    const ids = collectDone.evaluations.map((manifest) => manifest.id).sort()
    expect(ids).toEqual(['evals.bakeoff', 'evals.failing', 'evals.passing', 'prompt:fixture.greeter'])
    expect(collectDone.errors).toEqual([])

    expect(exitCode).toBe(1)
    const evalDones = events.filter((event) => event.type === 'eval:done')
    expect(evalDones).toHaveLength(3)

    const runDone = events.at(-1)!
    if (runDone.type !== 'run:done') throw new Error('expected run:done last')
    expect(runDone.exitCode).toBe(1)
    expect(runDone.experiments).toHaveLength(3)
    const runIds = new Set(events.map((event) => event.runId))
    expect(runIds.size).toBe(1)
    expect([...runIds][0]).toMatch(/^[0-9A-Z]{26}$/)
  }, 60_000)

  it('a variant bakeoff produces paired comparison deltas and trips minDeltaVsBaseline (exit 1)', async () => {
    const { exitCode, events, stderr } = await runWorker(['evals.bakeoff'])

    expect(exitCode, stderr).toBe(1)
    const evalDone = events.find((event) => event.type === 'eval:done')
    if (evalDone?.type !== 'eval:done') throw new Error('expected eval:done')

    // All three variants executed; aggregates are per variant.
    expect(Object.keys(evalDone.aggregates.perVariant).sort()).toEqual(['candidate', 'cheap', 'current'])

    // Paired deltas against the declared baseline variant, zero variance.
    expect(evalDone.comparison).toBeDefined()
    const comparison = evalDone.comparison!
    expect(comparison.kind).toBe('variant')
    expect(comparison.baseline).toBe('current')
    const candidateQuality = comparison.deltas.find(
      (delta) => delta.variantName === 'candidate' && delta.scoreName === 'quality',
    )!
    expect(candidateQuality.meanDelta).toBeCloseTo(-0.1, 10)
    expect(candidateQuality.sem).toBeCloseTo(0, 10)
    expect(candidateQuality.n).toBe(3)

    // The delta gate evaluates per non-baseline variant and reds the run.
    const gateResults = evalDone.gates.results
    expect(gateResults.map((result) => result.variantName).sort()).toEqual(['candidate', 'cheap'])
    expect(gateResults.every((result) => result.gate === 'scores.quality.minDeltaVsBaseline')).toBe(true)
    expect(gateResults.every((result) => result.passed === false)).toBe(true)
    expect(evalDone.gates.passed).toBe(false)
    expect(evalDone.gates.informational).toBe(false)
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

  it('lowered prompt-tests fail closed when no explicit model runtime is bound', async () => {
    const { exitCode, events, stderr } = await runWorker(['prompt:fixture.greeter'])

    expect(exitCode, stderr).toBe(2)
    const error = events.find((event) => event.type === 'error')
    expect(error).toMatchObject({
      type: 'error',
      scope: 'execute',
      code: 'project_model.model_executor_missing',
    })
    expect(error?.message).toContain('prompt:fixture.greeter')
    expect(error?.message).toContain('pass `generate` in the eval')
  }, 60_000)

  it('--collect-only emits manifests and executes nothing', async () => {
    const { exitCode, events } = await runWorker(['--collect-only'])

    expect(exitCode).toBe(0)
    expect(events.some((event) => event.type === 'collect:done')).toBe(true)
    expect(events.some((event) => event.type === 'eval:start')).toBe(false)
  }, 60_000)

  it('--replay wins over project config replay defaults', async () => {
    const defaulted = await runWorker(['evals.passing'], { config: REPLAY_DEFAULT_CONFIG })
    expect(defaulted.exitCode, defaulted.stderr).toBe(0)
    const defaultedDone = defaulted.events.find((event) => event.type === 'eval:done')
    if (defaultedDone?.type !== 'eval:done') throw new Error('expected eval:done from config-default run')
    expect(defaultedDone.replay?.mode).toBe('record-new')

    const live = await runWorker(['evals.passing', '--replay', 'live'], { config: REPLAY_DEFAULT_CONFIG })
    expect(live.exitCode, live.stderr).toBe(0)
    const liveDone = live.events.find((event) => event.type === 'eval:done')
    if (liveDone?.type !== 'eval:done') throw new Error('expected eval:done from CLI-replay run')
    expect(liveDone.replay).toBeUndefined()
  }, 60_000)

  it('file-discovered model-backed evals fail closed before project setup provides an implicit model runtime', async () => {
    const markerDir = await mkdtemp(join(tmpdir(), 'crux-quality-'))
    const markerPath = join(markerDir, 'setup-called.txt')

    try {
      const { exitCode, events, stderr } = await runWorker(['evals.implicit-model'], {
        config: IMPLICIT_MODEL_CONFIG,
        env: { CRUX_QUALITY_SETUP_MARKER: markerPath },
      })

      expect(exitCode, stderr).toBe(2)
      const error = events.find((event) => event.type === 'error')
      expect(error).toMatchObject({
        type: 'error',
        scope: 'execute',
        code: 'project_model.model_executor_missing',
      })
      expect(error?.message).toContain('evals.implicit-model')
      expect(error?.message).toContain('pass `generate` in the eval')
      expect(existsSync(markerPath)).toBe(false)
    } finally {
      await rm(markerDir, { recursive: true, force: true })
    }
  }, 60_000)

  it('file-discovered judge scorers fail closed with a missing-binding diagnostic', async () => {
    const { exitCode, events, stderr } = await runWorker(['evals.judge-missing-binding'], {
      config: MISSING_BINDING_CONFIG,
    })

    expect(exitCode, stderr).toBe(2)
    const error = events.find((event) => event.type === 'error')
    expect(error).toMatchObject({
      type: 'error',
      scope: 'execute',
      code: 'project_model.model_executor_missing',
    })
    expect(error?.message).toContain('evals.judge-missing-binding')
    expect(error?.message).toContain('needs an adapter generate fn')
  }, 60_000)

  it('file-discovered embedding scorers fail closed with a missing-binding diagnostic', async () => {
    const { exitCode, events, stderr } = await runWorker(['evals.embedding-missing-binding'], {
      config: MISSING_BINDING_CONFIG,
    })

    expect(exitCode, stderr).toBe(2)
    const error = events.find((event) => event.type === 'error')
    expect(error).toMatchObject({
      type: 'error',
      scope: 'execute',
      code: 'project_model.model_executor_missing',
    })
    expect(error?.message).toContain('evals.embedding-missing-binding')
    expect(error?.message).toContain('needs an embed fn')
  }, 60_000)
})
