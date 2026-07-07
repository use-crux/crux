import { describe, expect, it } from 'vitest'
import { evaluate } from '../../quality'
import { scorers } from '../../quality/scorers'
import type { Evaluation } from '../../quality/evaluate'
import type { RunOverrides } from '../../quality/experiment'
import type { GenerateFn } from '../../quality/target'
import { runEvaluationWithRunner, type QualityRunnerHarnessOptions } from './runner-harness'

function run(
  evaluation: Evaluation<never, never, string, string>,
  setup: QualityRunnerHarnessOptions['setup'],
  overrides?: RunOverrides<string>,
) {
  return runEvaluationWithRunner(evaluation, overrides, { setup })
}

/**
 * Stub adapter generate for judge calls: returns a structured judge verdict
 * and records every call's prompt + options for assertions.
 */
function judgeGenerateStub(object: Record<string, unknown>) {
  const calls: Array<{ promptId: string; system?: string; user?: string; model: unknown }> = []
  const generate: GenerateFn = async (prompt, opts) => {
    const promptRecord = prompt as unknown as { id: string; config: { system?: unknown; prompt?: unknown } }
    const optsRecord = opts as unknown as { model?: unknown }
    calls.push({
      promptId: promptRecord.id,
      system: typeof promptRecord.config.system === 'string' ? promptRecord.config.system : undefined,
      user: typeof promptRecord.config.prompt === 'string' ? promptRecord.config.prompt : undefined,
      model: optsRecord.model,
    })
    return { object }
  }
  return { generate, calls }
}

describe('scorers.judge — rubric mode', () => {
  it('scores through the runner generate fn with rationale in metadata', async () => {
    const stub = judgeGenerateStub({ reasoning: 'resolves the question directly', score: 0.9 })
    const evaluation = evaluate('judge.rubric', {
      task: async (input: { q: string }) => `answer to ${input.q}`,
      data: [{ input: { q: 'refunds' } }],
      scorers: [scorers.judge({ name: 'helpful', rubric: 'Does the answer resolve the question?' })],
    })

    const experiment = await run(evaluation, { generate: stub.generate, judgeModel: 'judge-model-1' })

    const cell = experiment.perCase[0]!
    expect(cell.status).toBe('passed')
    const helpful = cell.scores.find((score) => score.name === 'helpful')
    expect(helpful).toMatchObject({ name: 'helpful', score: 0.9, costClass: 'model' })
    expect(helpful?.metadata?.rationale).toBe('resolves the question directly')

    // Judge model resolution: runner judgeModel wins over runner model.
    expect(stub.calls).toHaveLength(1)
    expect(stub.calls[0]!.model).toBe('judge-model-1')
    // The rubric reaches the judge's system prompt; the output reaches the user prompt.
    expect(stub.calls[0]!.system).toContain('Does the answer resolve the question?')
    expect(stub.calls[0]!.user).toContain('answer to refunds')
  })

  it('falls back to runner model when no judgeModel is configured, resolving string refs via runner models', async () => {
    const stub = judgeGenerateStub({ reasoning: 'ok', score: 1 })
    const evaluation = evaluate('judge.model-fallback', {
      task: async () => 'out',
      data: [{ input: { q: 'x' } }],
      scorers: [scorers.judge({ name: 'j', rubric: 'r', model: 'cheap' })],
    })

    await run(evaluation, {
      generate: stub.generate,
      model: 'default-model',
      models: { cheap: 'resolved-cheap-model' },
    })

    expect(stub.calls[0]!.model).toBe('resolved-cheap-model')
  })

  it('scores through explicit judge generate and model bindings on the scorer', async () => {
    const stub = judgeGenerateStub({ reasoning: 'explicit scorer runtime', score: 0.8 })
    const evaluation = evaluate('judge.explicit-runtime', {
      task: async () => 'out',
      data: [{ input: { q: 'x' } }],
      scorers: [
        scorers.judge({
          name: 'j',
          rubric: 'r',
          generate: stub.generate,
          model: 'explicit-judge-model',
        }),
      ],
    })

    const experiment = await run(evaluation, {})

    expect(experiment.perCase[0]!.status).toBe('passed')
    expect(stub.calls[0]!.model).toBe('explicit-judge-model')
  })

  it('raises a definition error when no judge generate fn is available', async () => {
    const evaluation = evaluate('judge.no-setup', {
      task: async () => 'out',
      data: [{ input: { q: 'x' } }],
      scorers: [scorers.judge({ name: 'j', rubric: 'r' })],
    })

    await expect(run(evaluation, {})).rejects.toMatchObject({
      code: 'project_model.model_executor_missing',
      message: expect.stringContaining('eval-local helper'),
    })
  })

  it('throws an explicit binding error when invoked standalone (autoevals call shape)', () => {
    const scorer = scorers.judge({ name: 'j', rubric: 'r' })
    expect(() => scorer({ input: 'q', output: 'a', expected: undefined })).toThrow(/eval-local helper/)
  })
})

describe('scorers.judge — choiceScores mode', () => {
  it('maps the judged choice to its score with the choice as label', async () => {
    const stub = judgeGenerateStub({ reasoning: 'reads formal', score: 1, detail: { choice: 'formal' } })
    const evaluation = evaluate('judge.choices', {
      task: async () => 'Dear customer, …',
      data: [{ input: { q: 'tone?' } }],
      scorers: [scorers.judge({ name: 'tone', choiceScores: { formal: 1, casual: 0.5, rude: 0 } })],
    })

    const experiment = await run(evaluation, { generate: stub.generate, model: 'm' })
    const tone = experiment.perCase[0]!.scores.find((score) => score.name === 'tone')
    expect(tone).toMatchObject({ name: 'tone', score: 1, label: 'formal', costClass: 'model' })
    expect(tone?.metadata?.rationale).toBe('reads formal')
    // The declared choices reach the judge instructions.
    expect(stub.calls[0]!.system).toMatch(/formal, casual, rude/)
  })

  it('errors the cell when the judge returns an unknown choice', async () => {
    const stub = judgeGenerateStub({ reasoning: 'r', score: 1, detail: { choice: 'formal' } })
    const evaluation = evaluate('judge.choices-unknown', {
      task: async () => 'out',
      data: [{ input: { q: 'x' } }],
      scorers: [scorers.judge({ name: 'tone', choiceScores: { casual: 0.5, rude: 0 } })],
    })

    const experiment = await run(evaluation, { generate: stub.generate, model: 'm' })
    const cell = experiment.perCase[0]!
    expect(cell.status).toBe('errored')
    expect(cell.error?.message).toMatch(/unknown choice/)
  })

  it('rejects rubric + choiceScores together and an empty choiceScores at construction', () => {
    expect(() => scorers.judge({ name: 'x', rubric: 'r', choiceScores: { a: 1 } })).toThrow(/exactly one/)
    expect(() => scorers.judge({ name: 'x', choiceScores: {} })).toThrow(/at least one choice/)
  })
})

describe('scorers.judge — explanation envelope', () => {
  it('requests an explanation by default and drops it with useCoT: false', async () => {
    const stub = judgeGenerateStub({ reasoning: 'r', score: 1 })
    const withCoT = evaluate('judge.cot-on', {
      task: async () => 'out',
      data: [{ input: { q: 'x' } }],
      scorers: [scorers.judge({ name: 'j', rubric: 'Good?' })],
    })
    await run(withCoT, { generate: stub.generate, model: 'm' })
    expect(stub.calls[0]!.system).toMatch(/concise explanation/i)

    const stubOff = judgeGenerateStub({ reasoning: '', score: 1 })
    const withoutCoT = evaluate('judge.cot-off', {
      task: async () => 'out',
      data: [{ input: { q: 'x' } }],
      scorers: [scorers.judge({ name: 'j', rubric: 'Good?', useCoT: false })],
    })
    await run(withoutCoT, { generate: stubOff.generate, model: 'm' })
    expect(stubOff.calls[0]!.system).not.toMatch(/concise explanation/i)
  })
})

describe('autoevals-compatible plain scorers', () => {
  it('plain ({ input, output, expected }) => Score functions run unmodified next to built-ins', async () => {
    const stub = judgeGenerateStub({ reasoning: 'r', score: 0.5 })
    // The autoevals call shape: a bare async function returning { name, score }.
    const exactMatch = async (args: { input: unknown; output: unknown; expected: unknown }) => ({
      name: 'ExactMatch',
      score: args.output === args.expected ? 1 : 0,
    })

    const evaluation = evaluate('judge.autoevals', {
      task: async () => 'expected text',
      data: [{ input: { q: 'x' }, expected: 'expected text' }],
      scorers: [exactMatch, scorers.judge({ name: 'j', rubric: 'r' })],
    })

    const experiment = await run(evaluation, { generate: stub.generate, model: 'm' })
    const cell = experiment.perCase[0]!
    expect(cell.scores.find((score) => score.name === 'ExactMatch')).toMatchObject({ score: 1 })
    expect(cell.scores.find((score) => score.name === 'j')).toMatchObject({ score: 0.5 })
  })
})

describe('scorers via the factory-lambda form', () => {
  it('delivers the bound library: judge.select is contextually typed and runs end-to-end', async () => {
    const stub = judgeGenerateStub({ reasoning: 'r', score: 0.6 })
    const evaluation = evaluate('judge.factory', {
      task: async (input: { q: string }) => ({ answer: `re: ${input.q}` }),
      data: [{ input: { q: 'refunds' }, expected: { answer: 're: refunds' } }],
      // The factory receives the library pre-bound to this evaluation's types:
      // `select` sees the structured output without annotation.
      scorers: (s) => [s.judge({ name: 'helpful', rubric: 'Helpful?', select: (output) => output.answer }), s.exact()],
      gates: { scores: { helpful: { min: 0.5 } } },
    })

    const experiment = await run(evaluation, { generate: stub.generate, judgeModel: 'jm' })
    const cell = experiment.perCase[0]!
    expect(cell.scores.find((score) => score.name === 'helpful')).toMatchObject({ score: 0.6 })
    expect(cell.scores.find((score) => score.name === 'exact')).toMatchObject({ score: 1 })
    expect(stub.calls[0]!.user).toContain('re: refunds')
    expect(experiment.gates.passed).toBe(true)
  })
})

describe('scorers.judge — select enforcement', () => {
  it('judges the selected text for structured outputs', async () => {
    const stub = judgeGenerateStub({ reasoning: 'r', score: 0.7 })
    const evaluation = evaluate('judge.select', {
      task: async () => ({ answer: 'the selected answer', confidence: 0.4 }),
      data: [{ input: { q: 'x' } }],
      scorers: [
        scorers.judge<'graded', { answer: string; confidence: number }>({
          name: 'graded',
          rubric: 'r',
          select: (output) => output.answer,
        }),
      ],
    })

    const experiment = await run(evaluation, { generate: stub.generate, model: 'm' })
    expect(experiment.perCase[0]!.scores.find((score) => score.name === 'graded')?.score).toBe(0.7)
    expect(stub.calls[0]!.user).toContain('the selected answer')
    expect(stub.calls[0]!.user).not.toContain('confidence')
  })

  it('errors with a select-pointing message when a structured output has no select', async () => {
    const stub = judgeGenerateStub({ reasoning: 'r', score: 1 })
    const evaluation = evaluate('judge.select-missing', {
      task: async () => ({ structured: true }),
      data: [{ input: { q: 'x' } }],
      scorers: [scorers.judge({ name: 'j', rubric: 'r' }) as never],
    })

    const experiment = await run(evaluation, { generate: stub.generate, model: 'm' })
    const cell = experiment.perCase[0]!
    expect(cell.status).toBe('errored')
    expect(cell.error?.message).toMatch(/select/)
  })
})
