import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { prompt } from '../../prompt/prompt'
import { flow } from '../../flow/scope'
import { evaluate, target } from '../../quality'
import { getEvaluationDefinition, type Evaluation } from '../../quality/evaluate'
import type { GenerateFn } from '../../quality/target'
import type { RunOverrides } from '../../quality/experiment'
import { runEvaluation, QualityDefinitionError } from '../../quality/internal/engine'

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

/** A params-honoring fn task: echoes the params it received per execution. */
const echoParamsTask = (input: { q: string }, params: { tier?: string; topK?: number }) => ({
  q: input.q,
  tier: params.tier ?? 'none',
  topK: params.topK ?? 0,
})

describe('variant matrix execution', () => {
  it('declared variants replace the implicit default and execute with merged params', async () => {
    const evaluation = evaluate('variants.merge', {
      task: echoParamsTask,
      data: [{ name: 'one', input: { q: 'a' } }],
      params: { tier: 'base', topK: 5 },
      variants: {
        current: {},
        candidate: { tier: 'fancy' },
      },
    })
    const experiment = await run(evaluation)

    // No 'default' variant — the declared ones replace it.
    expect(Object.keys(experiment.aggregates.perVariant).sort()).toEqual(['candidate', 'current'])
    expect(experiment.perCase).toHaveLength(2)

    const current = experiment.perCase.find((cell) => cell.variantName === 'current')!
    const candidate = experiment.perCase.find((cell) => cell.variantName === 'candidate')!
    // `current` inherits params untouched; `candidate` overrides only `tier`.
    expect(current.output).toEqual({ q: 'a', tier: 'base', topK: 5 })
    expect(candidate.output).toEqual({ q: 'a', tier: 'fancy', topK: 5 })

    // The record's variants array carries override keys (and serializable values).
    expect(experiment.variants).toEqual([
      { name: 'current', overrideKeys: [] },
      { name: 'candidate', overrideKeys: ['tier'], overrides: { tier: 'fancy' } },
    ])
  })

    it('ctx.variant exposes the variant name and effective params to expect callbacks', async () => {
    const seen: Array<{ name: string; tier: unknown }> = []
    const evaluation = evaluate('variants.ctx', {
      task: echoParamsTask,
      data: [{ input: { q: 'a' } }],
      params: { tier: 'base' },
      variants: { current: {}, candidate: { tier: 'fancy' } },
      expect: (ctx) => {
        seen.push({ name: ctx.variant.name, tier: (ctx.variant.params as { tier?: string }).tier })
      },
    })
    await run(evaluation)
    expect(seen.sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: 'candidate', tier: 'fancy' },
      { name: 'current', tier: 'base' },
    ])
  })

    it('merges steps/tools override records per entry instead of replacing them', async () => {
    const seenSteps: Array<Record<string, unknown>> = []
    const task = (input: { q: string }, params: { steps?: Record<string, { model?: string }> }) => {
      seenSteps.push(params.steps ?? {})
      return { q: input.q }
    }
    const evaluation = evaluate('variants.steps-merge', {
      task,
      data: [{ input: { q: 'a' } }],
      params: { steps: { plan: { model: 'base-model' }, write: { model: 'base-model' } } },
      variants: { candidate: { steps: { write: { model: 'fancy-model' } } } },
    })
    await run(evaluation)
    // The candidate inherits the `plan` entry and overrides only `write`.
    expect(seenSteps).toEqual([{ plan: { model: 'base-model' }, write: { model: 'fancy-model' } }])
  })

    it('a variant model override reaches the generate fn for that variant only (type-test item 7, runtime)', async () => {
    const modelsSeen: string[] = []
    const generate = (async (_prompt: never, opts: never) => {
      modelsSeen.push((opts as { model?: string }).model ?? '(none)')
      return { object: { answer: 'ok' } }
    }) as GenerateFn
    const supportPrompt = prompt({
      id: 'variants-support',
      input: z.object({ question: z.string() }),
      output: z.object({ answer: z.string() }),
      system: 'answer',
    })
    const evaluation = evaluate('variants.model-override', {
      task: supportPrompt,
      data: [{ input: { question: 'q' } }],
      params: { generate, model: 'base-model' },
      variants: { current: {}, cheaper: { model: 'cheap-model' } },
    })
    const experiment = await run(evaluation)
    expect(experiment.passed).toBe(true)
    expect(modelsSeen.sort()).toEqual(['base-model', 'cheap-model'])
  })

    it('a variant prompt substitution executes the replacement prompt (type-test item 8, runtime)', async () => {
    const promptIdsSeen: string[] = []
    const generate = (async (p: never, _opts: never) => {
      promptIdsSeen.push((p as { id?: string }).id ?? '(anon)')
      return { object: { answer: 'ok' } }
    }) as GenerateFn
    const basePrompt = prompt({
      id: 'prompt-v1',
      input: z.object({ question: z.string() }),
      output: z.object({ answer: z.string() }),
      system: 'v1',
    })
    const candidatePrompt = prompt({
      id: 'prompt-v2',
      input: z.object({ question: z.string() }),
      output: z.object({ answer: z.string() }),
      system: 'v2',
    })
    const evaluation = evaluate('variants.prompt-swap', {
      task: basePrompt,
      data: [{ input: { question: 'q' } }],
      params: { generate },
      variants: { current: {}, candidate: { prompt: candidatePrompt } },
    })
    await run(evaluation)
    expect(promptIdsSeen.sort()).toEqual(['prompt-v1', 'prompt-v2'])
  })

    it('a variant task substitution runs the substituted task for that variant', async () => {
    const baseTask = (_input: { q: string }) => ({ from: 'base' })
    const swappedTask = (_input: { q: string }) => ({ from: 'swapped' })
    const evaluation = evaluate('variants.task-swap', {
      task: baseTask,
      data: [{ input: { q: 'a' } }],
      variants: { current: {}, harness: { task: swappedTask } },
    })
    const experiment = await run(evaluation)
    const current = experiment.perCase.find((cell) => cell.variantName === 'current')!
    const harness = experiment.perCase.find((cell) => cell.variantName === 'harness')!
    expect(current.output).toEqual({ from: 'base' })
    expect(harness.output).toEqual({ from: 'swapped' })
    expect(experiment.variants.find((variant) => variant.name === 'harness')!.overrideKeys).toEqual(['task'])
  })

    it('a variant task lacking a capability honest-fails the assertion for that cell only', async () => {
    // The base flow task captures `steps`; the substituted plain fn does not.
    const baseFlow = flow<{ ok: boolean }, { q: string }>('variants-honest', async (ctx) => {
      await ctx.step('plan', async () => ({ goal: 'x' }))
      return { ok: true }
    })
    const fnTask = (_input: { q: string }) => ({ ok: true })
    const evaluation = evaluate('variants.honest-fail', {
      task: target.flow(baseFlow),
      data: [{ input: { q: 'a' } }],
      variants: { current: {}, harness: { task: fnTask } },
      expect: (ctx) => {
        ctx.expect.steps.toHaveRun('plan')
      },
    })
    const experiment = await run(evaluation)
    const current = experiment.perCase.find((cell) => cell.variantName === 'current')!
    const harness = experiment.perCase.find((cell) => cell.variantName === 'harness')!
    expect(current.status).toBe('passed')
    expect(harness.status).toBe('failed')
    expect(harness.assertions.failures[0]!.matcher).toBe('steps (uncaptured)')
    expect(harness.assertions.failures[0]!.message).toContain('no steps signal was captured')
  })

    it('aggregates and consistency are computed per variant', async () => {
    let candidateCalls = 0
    const task = (_input: { q: string }, params: { flaky?: boolean }) => {
      if (params.flaky === true) {
        candidateCalls += 1
        return { good: candidateCalls % 2 === 0 }
      }
      return { good: true }
    }
    const evaluation = evaluate('variants.aggregates', {
      task,
      data: [{ name: 'only-case', input: { q: 'a' } }],
      trials: 2,
      concurrency: 1,
      variants: { current: {}, candidate: { flaky: true } },
      expect: (ctx) => {
        ctx.expect(ctx.output.good).toBe(true)
      },
    })
    const experiment = await run(evaluation)
    const current = experiment.aggregates.perVariant.current!
    const candidate = experiment.aggregates.perVariant.candidate!
    expect(current).toMatchObject({ cells: 2, passed: 2, passRate: 1 })
    expect(current.consistency).toEqual({ passAtK: 1, passAllTrials: 1 })
    expect(candidate.passed).toBe(1)
    expect(candidate.consistency).toEqual({ passAtK: 1, passAllTrials: 0 })
  })
})

describe('variant filters (RunOverrides.variants)', () => {
  const evaluationWithBaseline = () =>
    evaluate('variants.filter', {
      task: echoParamsTask,
      data: [{ input: { q: 'a' } }],
      params: { tier: 'base' },
      variants: { current: {}, candidate: { tier: 'fancy' }, cheap: { tier: 'cheap' } },
      baseline: 'current',
    })

    it('runs only the selected variants', async () => {
    const experiment = await run(evaluationWithBaseline(), { variants: ['current', 'candidate'] })
    expect(Object.keys(experiment.aggregates.perVariant).sort()).toEqual(['candidate', 'current'])
    expect(experiment.perCase).toHaveLength(2)
  })

    it('a subset that includes the baseline keeps gates blocking', async () => {
    const experiment = await run(evaluationWithBaseline(), { variants: ['current', 'candidate'] })
    expect(experiment.filteredRun).toBe(false)
    expect(experiment.gates.informational).toBe(false)
  })

    it('a subset that excludes the baseline demotes gates to informational', async () => {
    const experiment = await run(evaluationWithBaseline(), { variants: ['candidate'] })
    expect(experiment.filteredRun).toBe(true)
    expect(experiment.gates.informational).toBe(true)
  })

    it('an unknown variant name is a definition error', async () => {
    await expect(run(evaluationWithBaseline(), { variants: ['nope'] })).rejects.toThrowError(QualityDefinitionError)
    await expect(run(evaluationWithBaseline(), { variants: ['nope'] })).rejects.toThrowError(/nope/)
  })
})
