import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { prompt } from '../../define'
import { flow } from '../../flow/scope'
import { agent } from '../../agent/agent'
import { evaluate, target, scorers, dataset, cassette } from '../../quality/api'
import { NotImplementedError } from '../../quality/internal/errors'

const supportPrompt = prompt({
  id: 'support',
  input: z.object({ question: z.string(), locale: z.enum(['en', 'nl']) }),
  output: z.object({ answer: z.string() }),
  system: 'Answer support questions.',
})

const summarizeFlow = flow<{ summary: string }, { topic: string }>('summarize', async () => ({ summary: '' }))

const supportAgent = agent({ id: 'support-agent', prompt: supportPrompt })

const baseCases = [{ input: { question: 'How do refunds work?', locale: 'en' as const } }]

describe('evaluate() — definition', () => {
  it('returns a frozen Evaluation with the discovery discriminant', () => {
    const evaluation = evaluate({ task: supportPrompt, data: baseCases })
    expect(evaluation._tag).toBe('CruxEvaluation')
    expect(Object.isFrozen(evaluation)).toBe(true)
    expect(evaluation.id).toBeUndefined()
  })

  it('carries an explicit id through the id-first form', () => {
    const evaluation = evaluate('support.refunds', { task: supportPrompt, data: baseCases })
    expect(evaluation.id).toBe('support.refunds')
    expect(evaluation.manifest.id).toBe('support.refunds')
    expect(evaluation.manifest.explicitId).toBe(true)
  })

  it('run() throws NotImplemented for phase 2', async () => {
    const evaluation = evaluate({ task: supportPrompt, data: baseCases })
    expect(() => evaluation.run()).toThrowError(NotImplementedError)
    expect(() => evaluation.run()).toThrowError(/phase 2/)
  })

  it('rejects missing task/data and malformed cases', () => {
    // @ts-expect-error — runtime guard for untyped callers
    expect(() => evaluate({ data: baseCases })).toThrowError(/`task` is required/)
    // @ts-expect-error — runtime guard for untyped callers
    expect(() => evaluate({ task: supportPrompt })).toThrowError(/`data` is required/)
    expect(() =>
      evaluate({
        task: supportPrompt,
        // @ts-expect-error — a case needs input or turns
        data: [{ expected: { answer: 'x' } }],
      }),
    ).toThrowError(/needs `input`/)
  })

  it('rejects unknown gates.scores keys at definition time when all scorer names are static', () => {
    expect(() =>
      evaluate({
        task: supportPrompt,
        data: baseCases,
        scorers: (s) => [s.judge({ name: 'helpful', rubric: 'r', select: (o) => o.answer })],
        gates: { scores: { helpfull: { min: 0.7 } } },
      }),
    ).toThrowError(/does not match any scorer name/)

    // 'pass' is always gateable; dynamic (unnamed) scorers skip the check.
    evaluate({
      task: supportPrompt,
      data: baseCases,
      scorers: (s) => [s.judge({ name: 'helpful', rubric: 'r', select: (o) => o.answer })],
      gates: { scores: { pass: { min: 1 } } },
    })
    evaluate({
      task: supportPrompt,
      data: baseCases,
      scorers: [({ output }) => ({ name: 'adhoc', score: output === undefined ? null : 1 })],
      gates: { scores: { adhoc: { min: 0.5 } } },
    })
  })

  it('rejects a baseline that names no declared variant (runtime guard)', () => {
    expect(() =>
      evaluate({
        task: supportPrompt,
        data: baseCases,
        variants: { candidate: { model: 'gpt-5-mini' } },
        // @ts-expect-error — runtime guard for untyped callers
        baseline: 'nope',
      }),
    ).toThrowError(/does not name a declared variant/)
  })
})

describe('evaluation.manifest — spec 02 §2 shape for inline-case definitions', () => {
  it('captures structural facts without executing anything', () => {
    let factoryCalls = 0
    const evaluation = evaluate('support.bakeoff', {
      task: supportPrompt,
      data: [
        { name: 'Refund Policy (EN)', input: { question: 'refunds?', locale: 'en' }, trials: 3, tags: ['smoke'] },
        { input: { question: 'verzending?', locale: 'nl' }, skip: 'flaky upstream' },
      ],
      expect: (ctx) => {
        ctx.expect(ctx.output.answer).toBeDefined()
      },
      scorers: (s) => {
        factoryCalls += 1
        return [s.judge({ name: 'helpful', rubric: 'Helpful?', select: (o) => o.answer }), s.exact()]
      },
      variants: { cheap: { model: 'gpt-5-mini' }, candidate: { prompt: supportPrompt } },
      baseline: 'cheap',
      trials: 2,
      gates: { passRate: { min: 0.9 } },
      replay: { mode: 'replay-strict', cassette: cassette('support') },
      description: 'Refund quality bar',
      tags: ['support'],
    })

    const manifest = evaluation.manifest
    expect(factoryCalls).toBe(1)
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      id: 'support.bakeoff',
      explicitId: true,
      file: '',
      exportName: '',
      source: 'file',
      description: 'Refund quality bar',
      tags: ['support'],
      task: { kind: 'prompt', ref: 'support', capabilities: ['modelCalls', 'citations', 'safety'] },
      hasEvaluationExpect: true,
      scorers: [
        { name: 'helpful', costClass: 'model' },
        { name: 'exact', costClass: 'code' },
      ],
      baseline: 'cheap',
      trials: 2,
      gates: { passRate: { min: 0.9 } },
      replay: { mode: 'replay-strict', cassette: 'support' },
      flags: { only: false, skip: false },
    })
    expect(manifest.variants).toEqual([
      { name: 'cheap', overrideKeys: ['model'] },
      { name: 'candidate', overrideKeys: ['prompt'] },
    ])
    expect(manifest.cases).toHaveLength(2)
    expect(manifest.cases[0]).toMatchObject({
      caseId: 'refund-policy-en',
      name: 'Refund Policy (EN)',
      hasExpect: false,
      trials: 3,
      tags: ['smoke'],
    })
    expect(manifest.cases[1]).toMatchObject({ hasExpect: false, trials: 2, skip: 'flaky upstream' })
    expect(Object.isFrozen(manifest)).toBe(true)
    expect(Object.isFrozen(manifest.cases)).toBe(true)
  })

  it('derives stable content-hash case ids independent of key order', () => {
    const a = evaluate({
      task: supportPrompt,
      data: [{ input: { question: 'q', locale: 'en' } }],
    })
    const b = evaluate({
      task: supportPrompt,
      data: [{ input: { locale: 'en', question: 'q' } }],
    })
    const idA = a.manifest.cases[0]!.caseId
    expect(idA).toMatch(/^[0-9a-f]{12}$/)
    expect(b.manifest.cases[0]!.caseId).toBe(idA)
  })

  it('marks unnamed scorer functions as (dynamic)', () => {
    const evaluation = evaluate({
      task: supportPrompt,
      data: baseCases,
      scorers: [({ output }) => ({ name: 'adhoc', score: output === undefined ? null : 1 })],
    })
    expect(evaluation.manifest.scorers).toEqual([{ name: '(dynamic)', costClass: 'code' }])
  })

  it('summarizes datasets without loading them', () => {
    const goldenSet = dataset('golden/support.jsonl', {
      input: z.object({ question: z.string(), locale: z.enum(['en', 'nl']) }),
    })
    const evaluation = evaluate({ task: supportPrompt, data: goldenSet })
    expect(evaluation.manifest.datasets).toEqual([{ path: 'golden/support.jsonl' }])
    expect(evaluation.manifest.cases).toEqual([])
  })

  it('detects task kinds for flows, agents, targets, and plain fns', () => {
    const flowEval = evaluate({ task: summarizeFlow, data: [{ input: { topic: 't' } }] })
    expect(flowEval.manifest.task).toMatchObject({ kind: 'flow', ref: 'summarize' })
    expect(flowEval.manifest.task.capabilities).toContain('steps')

    const agentEval = evaluate({ task: supportAgent, data: baseCases })
    expect(agentEval.manifest.task).toMatchObject({ kind: 'agent', ref: 'support-agent' })
    expect(agentEval.manifest.task.capabilities).toHaveLength(9)

    const targetEval = evaluate({ task: target.prompt(supportPrompt, { model: 'gpt-5' }), data: baseCases })
    expect(targetEval.manifest.task).toMatchObject({ kind: 'prompt', ref: 'support' })

    const fnEval = evaluate({
      task: async (input: { question: string }) => ({ category: input.question.length }),
      data: [{ input: { question: 'q' } }],
    })
    expect(fnEval.manifest.task).toMatchObject({ kind: 'fn', capabilities: [] })
  })

  it('records evaluate.only / evaluate.skip flags', () => {
    expect(evaluate.only({ task: supportPrompt, data: baseCases }).manifest.flags).toEqual({
      only: true,
      skip: false,
    })
    expect(evaluate.skip({ task: supportPrompt, data: baseCases }).manifest.flags).toEqual({
      only: false,
      skip: true,
    })
  })
})

describe('target.*', () => {
  it('wraps primitives with kind, id, and capability sets', () => {
    const t = target.flow(summarizeFlow)
    expect(t).toMatchObject({ _tag: 'QualityTarget', kind: 'flow', id: 'summarize' })
    expect(t.capabilities).toEqual(['modelCalls', 'steps', 'toolCalls', 'routing', 'safety', 'memory'])
    expect(Object.isFrozen(t)).toBe(true)
  })

  it('rejects mismatched primitives', () => {
    expect(() => target.prompt(summarizeFlow as never)).toThrowError(/expected a Crux prompt/)
    expect(() => target.agent(supportPrompt as never)).toThrowError(/expected a Crux agent/)
    expect(() => target.flow(supportPrompt as never)).toThrowError(/expected a Crux flow handle/)
  })

  it('builds custom fn targets via the callable form', () => {
    const t = target({ id: 'harness', run: (input: { q: string }) => input.q })
    expect(t).toMatchObject({ _tag: 'QualityTarget', kind: 'fn', id: 'harness', capabilities: [] })
  })
})

describe('code-class scorers', () => {
  const args = <O, E>(output: O, expected?: E) => ({ input: {}, output, expected })

  it('exact: canonical-JSON equality, null without expected', async () => {
    const s = scorers.exact()
    expect(await s(args({ b: 2, a: 1 }, { a: 1, b: 2 }))).toMatchObject({ name: 'exact', score: 1 })
    expect(await s(args('x', 'y'))).toMatchObject({ score: 0 })
    expect(await s(args('x'))).toMatchObject({ score: null })
    expect(s.scorerName).toBe('exact')
    expect(s.costClass).toBe('code')
  })

  it('contains: explicit needle or string expected', async () => {
    expect(await scorers.contains()(args('the refund window is 14 days', 'refund'))).toMatchObject({ score: 1 })
    expect(await scorers.contains({ value: 'days' })(args('14 days'))).toMatchObject({ score: 1 })
    expect(await scorers.contains()(args('nothing here'))).toMatchObject({ score: null })
  })

  it('regex: tests output text, statelessly for global patterns', async () => {
    const s = scorers.regex({ pattern: /refund/g })
    expect(await s(args('refund refund'))).toMatchObject({ score: 1 })
    expect(await s(args('refund refund'))).toMatchObject({ score: 1 })
    expect(await s(args('credit'))).toMatchObject({ score: 0 })
  })

  it('levenshtein: normalized similarity for string pairs, null otherwise', async () => {
    const s = scorers.levenshtein()
    expect(await s(args('kitten', 'kitten'))).toMatchObject({ score: 1 })
    const result = await s(args('kitten', 'sitting'))
    expect(result.score).toBeCloseTo(1 - 3 / 7, 5)
    expect(await s(args({ a: 1 }, 'x'))).toMatchObject({ score: null })
  })

  it('jsonValid: parses string outputs, passes structured outputs', async () => {
    const s = scorers.jsonValid()
    expect(await s(args('{"a":1}'))).toMatchObject({ score: 1 })
    expect(await s(args('{nope'))).toMatchObject({ score: 0 })
    expect(await s(args({ a: 1 }))).toMatchObject({ score: 1 })
  })

  it('jsonDiff: partial structural credit', async () => {
    const s = scorers.jsonDiff()
    expect(await s(args({ a: 1, b: 'x' }, { a: 1, b: 'x' }))).toMatchObject({ score: 1 })
    const half = await s(args({ a: 1, b: 'x' }, { a: 1, b: 'y' }))
    expect(half.score).toBeGreaterThan(0.4)
    expect(half.score).toBeLessThan(1)
    expect(await s(args({ a: 1 }))).toMatchObject({ score: null })
  })

  it('judge: validates rubric XOR choiceScores at factory time, throws phase-5 stub at scoring time', () => {
    expect(() => scorers.judge({ name: 'x' })).toThrowError(/exactly one of/)
    expect(() => scorers.judge({ name: 'x', rubric: 'r', choiceScores: { a: 1 } })).toThrowError(/exactly one of/)
    const s = scorers.judge({ name: 'helpful', rubric: 'Helpful?' })
    expect(s.scorerName).toBe('helpful')
    expect(s.costClass).toBe('model')
    expect(() => s(args('text'))).toThrowError(NotImplementedError)
  })
})

describe('dataset() and cassette()', () => {
  it('dataset validates inputs and freezes the reference', () => {
    const ds = dataset('golden/x.jsonl', { input: z.object({ q: z.string() }) })
    expect(ds).toMatchObject({ _tag: 'CruxDataset', path: 'golden/x.jsonl' })
    expect(Object.isFrozen(ds)).toBe(true)
    expect(() => dataset('', { input: z.object({}) })).toThrowError(/non-empty/)
    expect(() => dataset('x.json', { input: {} as never })).toThrowError(/Standard Schema/)
  })

  it('cassette validates its name and freezes the reference', () => {
    const c = cassette('support', { mode: 'replay-strict' })
    expect(c).toMatchObject({ _tag: 'CruxCassette', name: 'support', mode: 'replay-strict' })
    expect(Object.isFrozen(c)).toBe(true)
    expect(() => cassette('')).toThrowError(/non-empty/)
  })
})
