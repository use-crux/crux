import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { loopRuntimeAdapter } from '../../adapter'
import { fakeLoopRuntime } from '../../adapter/testing'
import { prompt } from '../../prompt/prompt'
import { evaluate } from '../../quality'
import type { Score } from '../../quality/scorers'
import { runEvaluationWithRunner as run } from './runner-harness'

describe('Quality runner — output cache and reuseOutputs (spec 03 §5)', () => {
  it('reuses cached outputs under reuseOutputs without re-executing the task, re-running scorers fresh', async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'crux-quality-cache-'))
    let taskCalls = 0
    let scorerCalls = 0
    const makeEvaluation = () =>
      evaluate('cache.reuse', {
        task: async (input: { q: string }) => {
          taskCalls++
          return input.q.toUpperCase()
        },
        data: [
          { name: 'a', input: { q: 'aa' } },
          { name: 'b', input: { q: 'bb' } },
        ],
        scorers: [
          ({ output }): Score => {
            scorerCalls++
            return {
              name: 'len',
              score: typeof output === 'string' ? output.length / 10 : null,
            }
          },
        ],
      })

    const first = await run(makeEvaluation(), undefined, { cacheDir })
    expect(taskCalls).toBe(2)
    expect(scorerCalls).toBe(2)
    expect(first.cells.every((cell) => cell.metadata?.cached !== true)).toBe(true)

    const second = await run(makeEvaluation(), { reuseOutputs: true }, { cacheDir })
    expect(taskCalls).toBe(2) // tasks NOT re-executed
    expect(scorerCalls).toBe(4) // scorers re-ran against cached outputs
    expect(second.cells).toHaveLength(2)
    for (const cell of second.cells) {
      expect(cell.status).toBe('passed')
      expect(cell.metadata?.cached).toBe(true)
      expect(cell.output).toMatch(/^(AA|BB)$/)
      expect(cell.scores.find((score) => score.name === 'len')).toBeDefined()
    }
  })

  it('a changed task misses the cache (taskFingerprint differs) and executes live', async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'crux-quality-cache-'))
    let calls = 0
    const original = evaluate('cache.miss', {
      task: async (input: { q: string }) => {
        calls++
        return input.q.toUpperCase()
      },
      data: [{ input: { q: 'aa' } }],
    })
    await run(original, undefined, { cacheDir })
    expect(calls).toBe(1)

    const changed = evaluate('cache.miss', {
      task: async (input: { q: string }) => {
        calls++
        return input.q.toLowerCase()
      },
      data: [{ input: { q: 'aa' } }],
    })
    const experiment = await run(changed, { reuseOutputs: true }, { cacheDir })
    expect(calls).toBe(2) // cache miss → live execution
    expect(experiment.cells[0]!.metadata?.cached).not.toBe(true)
    expect(experiment.cells[0]!.output).toBe('aa')
  })

  it('a named case with changed input misses the cache and executes live', async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'crux-quality-cache-'))
    let calls = 0
    const makeEvaluation = (q: string) =>
      evaluate('cache.named-input-drift', {
        task: async (input: { q: string }) => {
          calls++
          return input.q.toUpperCase()
        },
        data: [{ name: 'same-name', input: { q } }],
      })

    await run(makeEvaluation('aa'), undefined, { cacheDir })
    expect(calls).toBe(1)

    const experiment = await run(makeEvaluation('bb'), { reuseOutputs: true }, { cacheDir })

    expect(calls).toBe(2)
    expect(experiment.cells[0]!.metadata?.cached).not.toBe(true)
    expect(experiment.cells[0]!.output).toBe('BB')
  })

  it('a prompt task with changed prompt content misses the cache and executes live', async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'crux-quality-cache-'))
    const fake = fakeLoopRuntime({
      loops: [[{ text: 'old' }], [{ text: 'new' }]],
    })
    const executor = loopRuntimeAdapter(fake.runtime)
    const makeEvaluation = (revision: 'old' | 'new') =>
      evaluate('cache.prompt-drift', {
        task: prompt({
          id: 'cache.prompt',
          input: z.object({ q: z.string() }),
          prompt: revision === 'old' ? () => 'old prompt' : () => 'new prompt',
        }),
        data: [{ input: { q: 'same' } }],
      })
    const setup = {
      generate: executor.generate.bind(executor) as never,
      model: 'fake:m1',
    }

    await run(makeEvaluation('old'), undefined, { cacheDir, setup })
    expect(fake.calls.runTextLoop).toHaveLength(1)

    const experiment = await run(makeEvaluation('new'), { reuseOutputs: true }, { cacheDir, setup })

    expect(fake.calls.runTextLoop).toHaveLength(2)
    expect(experiment.cells[0]!.metadata?.cached).not.toBe(true)
    expect(experiment.cells[0]!.output).toBe('new')
  })

  it('reuseOutputs without any cache executes live (miss = live, never an error)', async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'crux-quality-cache-'))
    let calls = 0
    const evaluation = evaluate('cache.cold', {
      task: async (input: { q: string }) => {
        calls++
        return input.q
      },
      data: [{ input: { q: 'cold' } }],
    })
    const experiment = await run(evaluation, { reuseOutputs: true }, { cacheDir })

    expect(calls).toBe(1)
    expect(experiment.cells[0]!.status).toBe('passed')
  })

  it('does not reuse the cache when reuseOutputs is not set, but keeps it warm', async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'crux-quality-cache-'))
    let calls = 0
    const makeEvaluation = () =>
      evaluate('cache.warm', {
        task: async (input: { q: string }) => {
          calls++
          return input.q
        },
        data: [{ input: { q: 'warm' } }],
      })
    await run(makeEvaluation(), undefined, { cacheDir })
    await run(makeEvaluation(), undefined, { cacheDir })
    expect(calls).toBe(2) // live both times — cache reads are opt-in

    await run(makeEvaluation(), { reuseOutputs: true }, { cacheDir })
    expect(calls).toBe(2) // and the cache stayed warm
  })
})
