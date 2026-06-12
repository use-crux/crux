import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { evaluate } from '../../quality'
import { getEvaluationDefinition, type Evaluation } from '../../quality/evaluate'
import type { RunOverrides } from '../../quality/experiment'
import { runEvaluation, QualityDefinitionError } from '../../quality/internal/engine'
import { baselineRecordPath, readBaselineRecord, type BaselineRecord } from '../../quality/internal/baseline'

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

const qualityDir = () => mkdtemp(join(tmpdir(), 'crux-quality-baselines-'))

/**
 * A deterministic two-variant bakeoff over a scored fn task: the candidate
 * scores `delta` lower than the baseline on the `quality` scorer, per case.
 */
function bakeoff(input: { id?: string; delta: number; gates?: object }) {
  const scoreByCase: Record<string, number> = { easy: 1, medium: 0.8, hard: 0.6 }
  const task = (caseInput: { name: string }, params: { handicap?: number }) => ({
    score: Math.max(0, (scoreByCase[caseInput.name] ?? 0) - (params.handicap ?? 0)),
  })
  const options = {
    task,
    data: [
      { name: 'easy', input: { name: 'easy' } },
      { name: 'medium', input: { name: 'medium' } },
      { name: 'hard', input: { name: 'hard' } },
    ],
    scorers: [
      Object.assign(({ output }: { input: unknown; output: unknown; expected: unknown }) => ({
        name: 'quality',
        score: (output as { score: number }).score,
      })),
    ],
    variants: { current: {}, candidate: { handicap: input.delta } },
    baseline: 'current',
    ...(input.gates !== undefined ? { gates: input.gates } : {}),
  }
  return input.id !== undefined ? evaluate(input.id, options as never) : evaluate(options as never)
}

describe('paired-difference comparison (variant baseline)', () => {
  it('computes per-score paired deltas with SEM and matched case counts', async () => {
    const experiment = await run(bakeoff({ id: 'baselines.bakeoff', delta: 0.1 }))
    expect(experiment.comparison).toBeDefined()
    const comparison = experiment.comparison!
    expect(comparison.kind).toBe('variant')
    expect(comparison.baseline).toBe('current')
    expect(comparison.unmatchedCases).toEqual({ baselineOnly: [], candidateOnly: [] })

    const quality = comparison.deltas.find((delta) => delta.scoreName === 'quality')!
    // Paired per case: every case drops exactly 0.1 → meanDelta −0.1, SEM 0.
    expect(quality.variantName).toBe('candidate')
    expect(quality.meanDelta).toBeCloseTo(-0.1, 10)
    expect(quality.sem).toBeCloseTo(0, 10)
    expect(quality.n).toBe(3)

    // The lowered pass score participates in the comparison too.
    expect(comparison.deltas.some((delta) => delta.scoreName === 'pass')).toBe(true)
  })

  it('trips a minDeltaVsBaseline gate per candidate variant and reds the run', async () => {
    const experiment = await run(
      bakeoff({
        id: 'baselines.gate-trip',
        delta: 0.1,
        gates: { scores: { quality: { minDeltaVsBaseline: -0.02 } } },
      }),
    )
    expect(experiment.gates.results).toEqual([
      {
        gate: 'scores.quality.minDeltaVsBaseline',
        variantName: 'candidate',
        threshold: -0.02,
        actual: expect.closeTo(-0.1, 5) as number,
        passed: false,
      },
    ])
    expect(experiment.gates.passed).toBe(false)
    expect(experiment.passed).toBe(false)
  })

  it('passes a minDeltaVsBaseline gate when the candidate holds the line', async () => {
    const experiment = await run(
      bakeoff({
        id: 'baselines.gate-pass',
        delta: 0,
        gates: { scores: { quality: { minDeltaVsBaseline: -0.02 } } },
      }),
    )
    expect(experiment.gates.results[0]).toMatchObject({ passed: true, actual: 0 })
    expect(experiment.passed).toBe(true)
  })
})

describe('promotion (Experiment.promote)', () => {
  it('writes the committed BaselineRecord with frozen per-case reference values', async () => {
    const dir = await qualityDir()
    const experiment = await run(bakeoff({ id: 'baselines.promote', delta: 0.1 }), undefined, { dir })
    const { baselineId, path } = await experiment.promote({ variant: 'current' })

    expect(path).toBe(baselineRecordPath(dir, 'baselines.promote'))
    const record = JSON.parse(await readFile(path, 'utf8')) as BaselineRecord
    expect(record).toMatchObject({
      schemaVersion: 1,
      baselineId,
      evaluationId: 'baselines.promote',
      experimentId: experiment.experimentId,
      variantName: 'current',
      configFingerprint: experiment.configFingerprint,
    })
    expect(Date.parse(record.promotedAt)).not.toBeNaN()
    expect(record.reference).toMatchObject({
      easy: { quality: 1, pass: 1 },
      medium: { quality: 0.8, pass: 1 },
      hard: { quality: expect.closeTo(0.6, 10) as number, pass: 1 },
    })
  })

  it('defaults the promoted variant to the declared baseline variant', async () => {
    const dir = await qualityDir()
    const experiment = await run(bakeoff({ id: 'baselines.promote-default', delta: 0.1 }), undefined, { dir })
    await experiment.promote()
    const record = await readBaselineRecord(dir, 'baselines.promote-default')
    expect(record!.variantName).toBe('current')
  })

  it('refuses to promote a filtered run', async () => {
    const dir = await qualityDir()
    const experiment = await run(bakeoff({ id: 'baselines.promote-filtered', delta: 0.1 }), { cases: ['easy'] }, { dir })
    expect(experiment.filteredRun).toBe(true)
    await expect(experiment.promote({ variant: 'current' })).rejects.toThrowError(/filtered/)
  })

  it('promoting a derived-id experiment with a pin id writes under the pinned id', async () => {
    const dir = await qualityDir()
    const evaluation = evaluate({ task: (input: { q: string }) => input, data: [{ input: { q: 'a' } }] })
    const experiment = await run(evaluation, undefined, { dir })
    const { path } = await experiment.promote({ id: 'pinned.id' })
    expect(path).toBe(baselineRecordPath(dir, 'pinned.id'))
  })
})

describe('auto-compare against a committed baseline', () => {
  it('a rerun auto-compares and an injected regression trips minDeltaVsBaseline', async () => {
    const dir = await qualityDir()
    // 1. Run the healthy version (single variant, no decay) and promote it.
    const healthy = evaluate('auto.compare', {
      task: (input: { name: string }) => ({ score: input.name === 'hard' ? 0.6 : 1 }),
      data: [
        { name: 'easy', input: { name: 'easy' } },
        { name: 'hard', input: { name: 'hard' } },
      ],
      scorers: [
        ({ output }: { input: unknown; output: unknown; expected: unknown }) => ({
          name: 'quality',
          score: (output as { score: number }).score,
        }),
      ],
      gates: { scores: { quality: { minDeltaVsBaseline: -0.02 } } },
    })
    const first = await run(healthy, undefined, { dir })
    // First run: no baseline yet — the delta gate is informational, run green.
    expect(first.gates.results[0]).toMatchObject({ informational: true })
    expect(first.passed).toBe(true)
    await first.promote()

    // 2. Re-run the SAME definition with a regressed task (same fingerprint
    //    requires the same definition shape — regress through the task body).
    const regressed = evaluate('auto.compare', {
      task: (input: { name: string }) => ({ score: input.name === 'hard' ? 0.2 : 1 }),
      data: [
        { name: 'easy', input: { name: 'easy' } },
        { name: 'hard', input: { name: 'hard' } },
      ],
      scorers: [
        ({ output }: { input: unknown; output: unknown; expected: unknown }) => ({
          name: 'quality',
          score: (output as { score: number }).score,
        }),
      ],
      gates: { scores: { quality: { minDeltaVsBaseline: -0.02 } } },
    })
    const second = await run(regressed, undefined, { dir })

    expect(second.baselineRef).toMatchObject({ experimentId: first.experimentId })
    expect(second.comparison).toMatchObject({ kind: 'promoted', baseline: first.experimentId })
    expect(second.comparison!.demoted).toBeUndefined()
    const delta = second.comparison!.deltas.find((entry) => entry.scoreName === 'quality')!
    // Paired: easy 0, hard −0.4 → mean −0.2.
    expect(delta.meanDelta).toBeCloseTo(-0.2, 10)
    expect(delta.n).toBe(2)

    expect(second.gates.results[0]).toMatchObject({
      gate: 'scores.quality.minDeltaVsBaseline',
      passed: false,
    })
    expect(second.gates.results[0]!.informational).toBeUndefined()
    expect(second.passed).toBe(false)
  })

  it('changing a case demotes the comparison to informational with the documented reason', async () => {
    const dir = await qualityDir()
    const makeEvaluation = (cases: ReadonlyArray<{ name: string; input: { name: string } }>) =>
      evaluate('auto.drift', {
        task: (input: { name: string }) => ({ score: input.name === 'hard' ? 0.2 : 1 }),
        data: cases,
        scorers: [
          ({ output }: { input: unknown; output: unknown; expected: unknown }) => ({
            name: 'quality',
            score: (output as { score: number }).score,
          }),
        ],
        gates: { scores: { quality: { minDeltaVsBaseline: -0.02 } } },
      })

    const first = await run(
      makeEvaluation([
        { name: 'easy', input: { name: 'easy' } },
        { name: 'hard', input: { name: 'hard' } },
      ]),
      undefined,
      { dir },
    )
    await first.promote()

    // Same id, changed case population → configFingerprint drift.
    const second = await run(
      makeEvaluation([
        { name: 'easy', input: { name: 'easy' } },
        { name: 'tricky', input: { name: 'tricky' } },
      ]),
      undefined,
      { dir },
    )
    expect(second.comparison!.demoted!.reason).toContain('configFingerprint mismatch')
    // The drifted comparison still reports deltas over matched cases and
    // lists the population mismatch honestly.
    expect(second.comparison!.unmatchedCases.baselineOnly).toEqual(['hard'])
    expect(second.comparison!.unmatchedCases.candidateOnly).toEqual(['tricky'])
    // Delta gates demote to informational — the run cannot red on them.
    expect(second.gates.results[0]).toMatchObject({ informational: true })
    expect(second.passed).toBe(true)
  })

  it('a promoted-then-renamed evaluation errors with the pin hint (id drift guard)', async () => {
    const dir = await qualityDir()
    const makeEvaluation = (id: string) =>
      evaluate(id, {
        task: (input: { q: string }) => input,
        data: [{ name: 'one', input: { q: 'a' } }],
      })
    const first = await run(makeEvaluation('drift.original'), undefined, { dir })
    await first.promote()

    // The same definition resolving to a DIFFERENT id (file renamed without
    // pinning): the run is refused with the exact pin line.
    const definition = getEvaluationDefinition(makeEvaluation('drift.original'))
    const renamed = { ...definition, id: undefined }
    await expect(
      runEvaluation(renamed, undefined, { persist: false, qualityId: 'test', dir, evaluationId: 'drift.renamed' }),
    ).rejects.toThrowError(QualityDefinitionError)
    await expect(
      runEvaluation(renamed, undefined, { persist: false, qualityId: 'test', dir, evaluationId: 'drift.renamed' }),
    ).rejects.toThrowError(/drift\.original/)
  })
})
