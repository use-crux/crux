import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { prompt } from '../../prompt/prompt'
import { loopRuntimeAdapter } from '../../adapter'
import { fakeLoopRuntime, type FakeLoopRuntimeConfig } from '../../adapter/testing'
import { evaluate, scorers } from '../../quality'
import type { RunOverrides } from '../../quality/experiment'
import { runEvaluationWithRunner, type QualityRunnerHarnessOptions } from './runner-harness'

const tempDirs: string[] = []
async function tempQualityDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'crux-replay-'))
  tempDirs.push(dir)
  return dir
}
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const answerPrompt = prompt({
  id: 'replay.answer',
  input: z.object({ q: z.string() }),
  prompt: ({ input }) => input.q,
})

/** A real executor boundary: fakeLoopRuntime behind loopRuntimeAdapter. */
function executorSetup(config: FakeLoopRuntimeConfig) {
  const fake = fakeLoopRuntime(config)
  const executor = loopRuntimeAdapter(fake.runtime)
  return {
    fake,
    generate: executor.generate.bind(executor) as never,
    liveCalls: () => fake.calls.runTextLoop.length,
  }
}

function run(evaluation: Parameters<typeof runEvaluationWithRunner>[0], options: QualityRunnerHarnessOptions, overrides?: RunOverrides<string>) {
  return runEvaluationWithRunner(evaluation, overrides, options)
}

const repeat = <T>(value: T, times: number): T[] => Array.from({ length: times }, () => value)

describe('engine replay — record-new then replay-strict', () => {
  it('records a cassette named after the evaluation id, then replays with zero live calls', async () => {
    const dir = await tempQualityDir()
    const { generate, liveCalls } = executorSetup({
      loops: repeat([{ text: 'recorded answer' }], 4),
    })
    const evaluation = evaluate('replay.smoke', {
      task: answerPrompt,
      data: [{ input: { q: 'how do refunds work?' } }],
      replay: 'record-new',
    })

    const recordRun = await run(evaluation, {
      dir,
      setup: { generate, model: 'fake:m1' },
    })
    expect(recordRun.cells[0]!.status).toBe('passed')
    expect(recordRun.replay).toMatchObject({
      mode: 'record-new',
      cassette: 'replay.smoke',
    })
    expect(liveCalls()).toBe(1)
    const cassetteFile = join(dir, 'cassettes', 'replay.smoke.json')
    expect(existsSync(cassetteFile)).toBe(true)

    const replayRun = await run(evaluation, { dir, setup: { generate, model: 'fake:m1' } }, { replayMode: 'replay-strict' })
    expect(liveCalls()).toBe(1) // zero new live calls
    expect(replayRun.cells[0]!.status).toBe('passed')
    expect(replayRun.cells[0]!.output).toBe('recorded answer')
    expect(replayRun.replay).toMatchObject({
      mode: 'replay-strict',
      cassette: 'replay.smoke',
    })
  })

  it('quality.defaults.replay fills when nothing else is declared; --replay live opts out', async () => {
    const dir = await tempQualityDir()
    const { generate } = executorSetup({ loops: repeat([{ text: 'a' }], 4) })
    const evaluation = evaluate('replay.defaults', {
      task: answerPrompt,
      data: [{ input: { q: 'x' } }],
    })

    await run(evaluation, {
      dir,
      setup: { generate, model: 'fake:m1' },
      defaults: { replay: 'record-new' },
    })
    expect(existsSync(join(dir, 'cassettes', 'replay.defaults.json'))).toBe(true)

    const liveDir = await tempQualityDir()
    await run(
      evaluation,
      {
        dir: liveDir,
        setup: { generate, model: 'fake:m1' },
        defaults: { replay: 'record-new' },
      },
      { replayMode: 'live' },
    )
    expect(existsSync(join(liveDir, 'cassettes'))).toBe(false)
  })

  it('fails a replay-strict miss closed: cell errored, phase replay, key + re-record hint', async () => {
    const dir = await tempQualityDir()
    const { generate, liveCalls } = executorSetup({
      loops: repeat([{ text: 'never' }], 2),
    })
    const evaluation = evaluate('replay.miss', {
      task: answerPrompt,
      data: [{ input: { q: 'unrecorded' } }],
      replay: 'replay-strict',
    })

    const experiment = await run(evaluation, {
      dir,
      setup: { generate, model: 'fake:m1' },
    })
    const cell = experiment.cells[0]!
    expect(cell.status).toBe('errored')
    expect(cell.error?.phase).toBe('replay')
    expect(cell.error?.message).toMatch(/[0-9a-f]{64}/)
    expect(cell.error?.message).toMatch(/record-new/)
    expect(liveCalls()).toBe(0)
    expect(experiment.passed).toBe(false)
  })

  it('misses replay-strict when a structured prompt output schema changes', async () => {
    const dir = await tempQualityDir()
    const makePrompt = (output: z.ZodType) =>
      prompt({
        id: 'replay.structured-schema',
        input: z.object({ q: z.string() }),
        output,
        prompt: ({ input }) => input.q,
      })
    const { fake, generate } = executorSetup({
      structured: ['{"answer":"recorded"}'],
    })

    await run(
      evaluate('replay.schema-drift', {
        task: makePrompt(z.object({ answer: z.string() })),
        data: [{ input: { q: 'refunds' } }],
        replay: 'record-new',
      }),
      { dir, setup: { generate, model: 'fake:m1' } },
    )
    expect(fake.calls.runStructuredAttempt).toHaveLength(1)

    const replay = await run(
      evaluate('replay.schema-drift', {
        task: makePrompt(z.object({ summary: z.string() })),
        data: [{ input: { q: 'refunds' } }],
        replay: 'replay-strict',
      }),
      { dir, setup: { generate, model: 'fake:m1' } },
    )

    expect(fake.calls.runStructuredAttempt).toHaveLength(1)
    expect(replay.cells[0]!.status).toBe('errored')
    expect(replay.cells[0]!.error?.phase).toBe('replay')
  })
})

describe('engine replay — trials collapse under replay-strict', () => {
  it('collapses trials to one execution per cell and notes it on the record', async () => {
    const dir = await tempQualityDir()
    const { generate } = executorSetup({ loops: repeat([{ text: 'a' }], 8) })
    const evaluation = evaluate('replay.trials', {
      task: answerPrompt,
      data: [{ input: { q: 'x' } }],
      trials: 3,
      replay: 'record-new',
    })

    const recordRun = await run(evaluation, {
      dir,
      setup: { generate, model: 'fake:m1' },
    })
    expect(recordRun.cells).toHaveLength(3) // trials run live under record-new

    const replayRun = await run(evaluation, { dir, setup: { generate, model: 'fake:m1' } }, { replayMode: 'replay-strict' })
    expect(replayRun.cells).toHaveLength(1)
    expect(replayRun.replay).toMatchObject({
      mode: 'replay-strict',
      trialsCollapsed: true,
    })
  })
})

describe('engine replay — variants share one cassette', () => {
  it('records once per variant, replays all variants from the same file', async () => {
    const dir = await tempQualityDir()
    const { generate, liveCalls } = executorSetup({
      loops: [[{ text: 'from m1' }], [{ text: 'from m2' }], [{ text: 'never' }], [{ text: 'never' }]],
    })
    const evaluation = evaluate('replay.variants', {
      task: answerPrompt,
      data: [{ input: { q: 'x' } }],
      variants: { current: {}, candidate: { model: 'fake:m2' } },
      baseline: 'current',
      replay: 'record-new',
    })

    await run(evaluation, { dir, setup: { generate, model: 'fake:m1' } })
    expect(liveCalls()).toBe(2)
    const files = await readdir(join(dir, 'cassettes'))
    expect(files).toEqual(['replay.variants.json'])

    const replayRun = await run(evaluation, { dir, setup: { generate, model: 'fake:m1' } }, { replayMode: 'replay-strict' })
    expect(liveCalls()).toBe(2)
    const outputs = replayRun.cells.map((cell) => cell.output).sort()
    expect(outputs).toEqual(['from m1', 'from m2'])
  })
})

describe('engine replay — judge scorers replay through the same cassette', () => {
  it('replay-strict serves judge calls from the cassette: zero live calls end-to-end', async () => {
    const dir = await tempQualityDir()
    const judgeVerdict = JSON.stringify({ reasoning: 'grounded', score: 0.9 })
    const make = () =>
      executorSetup({
        loops: repeat([{ text: 'the answer' }], 2),
        structured: [judgeVerdict, judgeVerdict],
      })

    const evaluation = evaluate('replay.judged', {
      task: answerPrompt,
      data: [{ input: { q: 'x' } }],
      scorers: [scorers.judge({ name: 'quality', rubric: 'Good answer?' })],
      replay: 'record-new',
    })

    const recorder = make()
    await run(evaluation, {
      dir,
      setup: { generate: recorder.generate, model: 'fake:m1' },
    })

    const replayer = make()
    const replayRun = await run(evaluation, { dir, setup: { generate: replayer.generate, model: 'fake:m1' } }, { replayMode: 'replay-strict' })
    expect(replayer.fake.calls.runTextLoop).toHaveLength(0)
    expect(replayer.fake.calls.runStructuredAttempt).toHaveLength(0)
    const judged = replayRun.cells[0]!.scores.find((score) => score.name === 'quality')
    expect(judged).toMatchObject({ score: 0.9 })
  })
})

describe('engine replay — named cassette and custom match', () => {
  it('uses the declared cassette name for storage', async () => {
    const dir = await tempQualityDir()
    const { generate } = executorSetup({ loops: repeat([{ text: 'a' }], 2) })
    const evaluation = evaluate('replay.named', {
      task: answerPrompt,
      data: [{ input: { q: 'x' } }],
      replay: { mode: 'record-new', cassette: 'shared-support' },
    })

    await run(evaluation, { dir, setup: { generate, model: 'fake:m1' } })
    expect(existsSync(join(dir, 'cassettes', 'shared-support.json'))).toBe(true)
  })

  it('refresh re-records entries in place', async () => {
    const dir = await tempQualityDir()
    const first = executorSetup({ loops: [[{ text: 'old' }]] })
    const evaluation = evaluate('replay.refresh', {
      task: answerPrompt,
      data: [{ input: { q: 'x' } }],
      replay: 'record-new',
    })
    await run(evaluation, {
      dir,
      setup: { generate: first.generate, model: 'fake:m1' },
    })

    const second = executorSetup({ loops: [[{ text: 'new' }]] })
    await run(evaluation, { dir, setup: { generate: second.generate, model: 'fake:m1' } }, { replayMode: 'refresh' })
    expect(second.liveCalls()).toBe(1)

    const text = await readFile(join(dir, 'cassettes', 'replay.refresh.json'), 'utf8')
    expect(text).toContain('new')
    expect(text).not.toContain('"old"')
  })
})
