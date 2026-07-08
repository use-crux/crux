import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { dataset, evaluate, scorers } from '../../quality'
import type { GenerateFn } from '../../quality/target'
import { runEvaluationWithRunner as run } from './runner-harness'

const qualityDir = () => mkdtemp(join(tmpdir(), 'crux-quality-baselines-'))

describe('promoted baseline identity', () => {
  it('fails loudly when a committed baseline is corrupt', async () => {
    const dir = await qualityDir()
    await mkdir(join(dir, 'baselines'), { recursive: true })
    await writeFile(join(dir, 'baselines', 'auto.corrupt.json'), '{not-json', 'utf8')

    const evaluation = evaluate('auto.corrupt', {
      task: (input: { q: string }) => input.q,
      data: [{ input: { q: 'x' } }],
    })

    await expect(run(evaluation, undefined, { dir })).rejects.toMatchObject({
      code: 'corrupt-baseline',
      message: expect.stringContaining('auto.corrupt.json'),
    })
  })

  it('changing a named case input demotes promoted-baseline comparison', async () => {
    const dir = await qualityDir()
    const makeEvaluation = (name: string) =>
      evaluate('auto.named-input-drift', {
        task: (input: { name: string }) => ({
          score: input.name === 'easy' ? 1 : 0.2,
        }),
        data: [{ name: 'same-case', input: { name } }],
        scorers: [
          ({ output }: { input: unknown; output: unknown; expected: unknown }) => ({
            name: 'quality',
            score: (output as { score: number }).score,
          }),
        ],
        gates: { scores: { quality: { minDeltaVsBaseline: -0.02 } } },
      })

    const first = await run(makeEvaluation('easy'), undefined, { dir })
    await first.promote()

    const second = await run(makeEvaluation('hard'), undefined, { dir })

    expect(second.comparison!.demoted!.reason).toContain('configFingerprint mismatch')
    expect(second.comparison!.unmatchedCases).toEqual({
      baselineOnly: [],
      candidateOnly: [],
    })
    expect(second.gates.results[0]).toMatchObject({ informational: true })
    expect(second.passed).toBe(true)
  })

  it('changing dataset file contents demotes promoted-baseline comparison', async () => {
    const rootDir = await qualityDir()
    const qualityDataDir = join(rootDir, '.crux/quality')
    await mkdir(join(rootDir, 'data'), { recursive: true })
    const datasetPath = join(rootDir, 'data/cases.json')
    const cases = dataset('data/cases.json', {
      input: z.object({ name: z.string() }),
    })
    const makeEvaluation = () =>
      evaluate('auto.dataset-drift', {
        task: (input: { name: string }) => ({
          score: input.name === 'easy' ? 1 : 0.2,
        }),
        data: cases,
        scorers: [
          ({ output }: { input: unknown; output: unknown; expected: unknown }) => ({
            name: 'quality',
            score: (output as { score: number }).score,
          }),
        ],
        gates: { scores: { quality: { minDeltaVsBaseline: -0.02 } } },
      })

    await writeFile(datasetPath, JSON.stringify([{ name: 'same-case', input: { name: 'easy' } }]), 'utf8')
    const first = await run(makeEvaluation(), undefined, {
      dir: qualityDataDir,
      rootDir,
    })
    await first.promote()

    await writeFile(datasetPath, JSON.stringify([{ name: 'same-case', input: { name: 'hard' } }]), 'utf8')
    const second = await run(makeEvaluation(), undefined, {
      dir: qualityDataDir,
      rootDir,
    })

    expect(second.comparison!.demoted!.reason).toContain('configFingerprint mismatch')
    expect(second.gates.results[0]).toMatchObject({ informational: true })
    expect(second.passed).toBe(true)
  })

  it('changing a judge rubric demotes promoted-baseline comparison', async () => {
    const dir = await qualityDir()
    const generate: GenerateFn = async () => ({
      object: { reasoning: 'ok', score: 0.9 },
    })
    const makeEvaluation = (rubric: string) =>
      evaluate('auto.judge-rubric-drift', {
        task: async () => 'answer',
        data: [{ input: { q: 'x' } }],
        scorers: [scorers.judge({ name: 'quality', rubric })],
        gates: { scores: { quality: { minDeltaVsBaseline: -0.02 } } },
      })

    const first = await run(makeEvaluation('grade helpfulness'), undefined, {
      dir,
      setup: { generate, model: 'judge-model' },
    })
    await first.promote()

    const second = await run(makeEvaluation('grade groundedness'), undefined, {
      dir,
      setup: { generate, model: 'judge-model' },
    })

    expect(second.comparison!.demoted!.reason).toContain('configFingerprint mismatch')
    expect(second.gates.results[0]).toMatchObject({ informational: true })
    expect(second.passed).toBe(true)
  })
})
