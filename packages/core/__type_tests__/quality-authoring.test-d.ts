/**
 * Type tests for the v1 Quality authoring surface (`@use-crux/core/quality`).
 *
 * These implement the 17-item checklist from the Quality API spec (01 §12).
 * Items 1–16 live here; item 17 (the `tsc --extendedDiagnostics` instantiation
 * budget) lives in `__tests__/quality/compile-perf.test.ts` over the 50-eval
 * fixture in `__type_tests__/fixtures/quality-perf-fixture.ts`.
 *
 * The inference contract under test (binding): `task` is the SOLE inference
 * site for input/output types. `data`, `scorers`, and `expect` are non-inference
 * positions — a typo'd case key must error on the case property, never on task.
 */

import { expectTypeOf } from 'vitest'
import { z } from 'zod'
import { prompt } from '../prompt/prompt'
import { flow } from '../flow/scope'
import { agent } from '../agent/agent'
import type { Retriever, RetrieverHit } from '../retrieval'
import { evaluate, scorers, dataset } from '../quality'
import type { CaseOf, EvaluationCoverageTargetId, InputOf, OutputOf } from '../quality'

// ─────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────

const supportPrompt = prompt({
  id: 'support',
  input: z.object({ question: z.string(), locale: z.enum(['en', 'nl']) }),
  output: z.object({ answer: z.string(), confidence: z.number() }),
  system: 'Answer support questions.',
})

// Text-mode prompt (no output schema → output is string)
const summaryPrompt = prompt({
  id: 'summary',
  input: z.object({ question: z.string(), locale: z.enum(['en', 'nl']) }),
  system: 'Summarize the question.',
})

// Variant-compatible: accepts a SUBSET of the task input, same output.
const compatiblePrompt = prompt({
  id: 'support-candidate',
  input: z.object({ question: z.string() }),
  output: z.object({ answer: z.string(), confidence: z.number() }),
  system: 'Answer better.',
})

// Input mismatch: requires a key the task input does not provide.
const inputMismatchPrompt = prompt({
  id: 'wrong-input',
  input: z.object({ topic: z.string() }),
  output: z.object({ answer: z.string(), confidence: z.number() }),
  system: 'Wrong input surface.',
})

// Output mismatch: produces a shape not assignable to the task output.
const outputMismatchPrompt = prompt({
  id: 'wrong-output',
  input: z.object({ question: z.string() }),
  output: z.object({ verdict: z.string() }),
  system: 'Wrong output surface.',
})

const summarizeFlow = flow<{ summary: string }, { topic: string }>('summarize', async () => ({ summary: '' }))

const supportAgent = agent({ id: 'support-agent', prompt: supportPrompt })

declare const docsRetriever: Retriever

const classify = async (input: { question: string }): Promise<{ category: string }> => ({
  category: input.question.length > 10 ? 'long' : 'short',
})

const classifyWithParams = async (input: { question: string }, params: { threshold: number }): Promise<boolean> =>
  input.question.length > params.threshold

const supportCases = [
  { input: { question: 'How do refunds work?', locale: 'en' } },
  { input: { question: 'Hoe werkt een refund?', locale: 'nl' } },
] as const

const textCases = [{ input: { question: 'Summarize refunds.', locale: 'en' } }] as const

// ─────────────────────────────────────────────────────────────────
// 1. Bare prompt as task: data input typed from zod input; ctx.output from
//    zod output (structured → object; text mode → string).
// ─────────────────────────────────────────────────────────────────

evaluate({
  task: supportPrompt,
  covers: ['prompt:support'],
  data: [{ input: { question: 'How do refunds work?', locale: 'en' } }],
  expect: (ctx) => {
    expectTypeOf(ctx.input).toEqualTypeOf<{ question: string; locale: 'en' | 'nl' }>()
    expectTypeOf(ctx.output).toEqualTypeOf<{ answer: string; confidence: number }>()
  },
})

expectTypeOf<'prompt:support'>().toExtend<EvaluationCoverageTargetId<'prompt'>>()

evaluate({
  task: summaryPrompt,
  data: [{ input: { question: 'Summarize this.', locale: 'en' } }],
  expect: (ctx) => {
    expectTypeOf(ctx.output).toEqualTypeOf<string>()
  },
})

evaluate({
  task: supportPrompt,
  // @ts-expect-error — coverage targets must use Project Index definition ids such as `prompt:support`
  covers: ['support'],
  data: [{ input: { question: 'How do refunds work?', locale: 'en' } }],
})

evaluate({
  task: supportPrompt,
  data: [
    {
      input: {
        question: 'ok',
        // @ts-expect-error — locale must be one of the zod enum values
        locale: 'de',
      },
    },
  ],
})

expectTypeOf<InputOf<typeof supportPrompt>>().toEqualTypeOf<{ question: string; locale: 'en' | 'nl' }>()
expectTypeOf<OutputOf<typeof supportPrompt>>().toEqualTypeOf<{ answer: string; confidence: number }>()
expectTypeOf<OutputOf<typeof summaryPrompt>>().toEqualTypeOf<string>()

// ─────────────────────────────────────────────────────────────────
// 2. Bare flow/agent/retriever as task: typed input/output plus the correct
//    capability set on ctx.expect.
// ─────────────────────────────────────────────────────────────────

evaluate({
  task: summarizeFlow,
  data: [{ input: { topic: 'pricing' } }],
  expect: (ctx) => {
    expectTypeOf(ctx.input).toEqualTypeOf<{ topic: string }>()
    expectTypeOf(ctx.output).toEqualTypeOf<{ summary: string }>()
    ctx.expect.steps.toHaveRun('plan')
    ctx.expect.memory.toHaveWritten()
    ctx.expect.routing.toHaveSelected('fast-path')
    // @ts-expect-error — flows do not capture handoffs
    ctx.expect.handoffs
    // @ts-expect-error — flows do not capture retrieval
    ctx.expect.retrieval
  },
})

evaluate({
  task: supportAgent,
  data: [{ input: { question: 'I want a refund', locale: 'en' } }],
  expect: (ctx) => {
    expectTypeOf(ctx.input).toEqualTypeOf<{ question: string; locale: 'en' | 'nl' }>()
    expectTypeOf(ctx.output).toEqualTypeOf<{ answer: string; confidence: number }>()
    ctx.expect.toolCalls.toHaveCalled('lookupOrder')
    ctx.expect.handoffs.toHaveHandedOffTo('billing')
    ctx.expect.retrieval.count().toBeGreaterThan(0)
    ctx.expect.citations.toAllResolve()
  },
})

evaluate({
  task: docsRetriever,
  data: [{ input: { query: 'refund policy' } }],
  expect: (ctx) => {
    expectTypeOf(ctx.input).toEqualTypeOf<{ query: string }>()
    expectTypeOf(ctx.output).toEqualTypeOf<readonly RetrieverHit[]>()
    ctx.expect.retrieval.toHaveTopHit({ sourceId: 'docs/refunds' })
  },
})

// ─────────────────────────────────────────────────────────────────
// 3. Plain annotated fn as task: inference from the signature.
// ─────────────────────────────────────────────────────────────────

evaluate({
  task: classify,
  data: [{ input: { question: 'is this long enough to be long?' } }],
  expect: (ctx) => {
    expectTypeOf(ctx.input).toEqualTypeOf<{ question: string }>()
    expectTypeOf(ctx.output).toEqualTypeOf<{ category: string }>()
  },
})

// ─────────────────────────────────────────────────────────────────
// 4. Typo'd case key errors ON THE CASE PROPERTY (NoInfer contract) —
//    the squiggle lands on the offending key, never on `task`.
// ─────────────────────────────────────────────────────────────────

evaluate({
  task: supportPrompt,
  data: [
    {
      input: {
        question: 'well formed',
        locale: 'en',
        // @ts-expect-error — excess/typo'd case key errors here, not on `task`
        questoin: 'typo',
      },
    },
  ],
})

// ─────────────────────────────────────────────────────────────────
// 5. expect.retrieval exists on retriever tasks; compile error on prompt tasks.
//    (Positive half asserted in item 2's retriever block.)
// ─────────────────────────────────────────────────────────────────

evaluate({
  task: supportPrompt,
  data: [{ input: { question: 'q', locale: 'en' } }],
  expect: (ctx) => {
    ctx.expect.citations.toCite('docs/refunds')
    ctx.expect.safety.toHavePassedGuardrails()
    ctx.expect.modelCalls.toHaveNoFallback()
    ctx.expect.latency.toBeUnderMs(2000)
    // @ts-expect-error — prompts do not capture retrieval
    ctx.expect.retrieval
  },
})

// ─────────────────────────────────────────────────────────────────
// 6. expect.toolCalls exists on agent tasks (item 2); compile error on plain fns.
// ─────────────────────────────────────────────────────────────────

evaluate({
  task: classify,
  data: [{ input: { question: 'q' } }],
  expect: (ctx) => {
    // always-on namespaces still exist on plain fns
    ctx.expect.latency.toBeUnderMs(50)
    ctx.expect.errors.toHaveNone()
    // @ts-expect-error — plain functions capture no toolCalls signal
    ctx.expect.toolCalls
  },
})

// ─────────────────────────────────────────────────────────────────
// 7. Variant override `{ model }` accepted on prompt task; ANY override is a
//    compile error on a params-less fn task; fn-with-params accepts its params.
// ─────────────────────────────────────────────────────────────────

evaluate({
  task: supportPrompt,
  data: supportCases,
  variants: { candidate: { model: 'openrouter/gpt-5' } },
})

evaluate({
  task: classify,
  data: [{ input: { question: 'q' } }],
  variants: {
    candidate: {
      // @ts-expect-error — a params-ignoring plain-fn task rejects ALL overrides
      model: 'openrouter/gpt-5',
    },
  },
})

evaluate({
  task: classifyWithParams,
  data: [{ input: { question: 'q' } }],
  variants: { strict: { threshold: 20 } },
})

evaluate({
  task: classifyWithParams,
  data: [{ input: { question: 'q' } }],
  variants: {
    strict: {
      // @ts-expect-error — override value must match the fn's params type
      threshold: 'high',
    },
  },
})

// ─────────────────────────────────────────────────────────────────
// 8. Variant `{ prompt }` compatibility: input mismatch and output mismatch
//    are both rejected; a compatible replacement is accepted.
// ─────────────────────────────────────────────────────────────────

evaluate({
  task: supportPrompt,
  data: supportCases,
  variants: {
    ok: { prompt: compatiblePrompt },
    badInput: {
      // @ts-expect-error — replacement prompt does not accept the task input
      prompt: inputMismatchPrompt,
    },
    badOutput: {
      // @ts-expect-error — replacement prompt output is not assignable to the task output
      prompt: outputMismatchPrompt,
    },
  },
})

// ─────────────────────────────────────────────────────────────────
// 9. `baseline` is keyof variants; rejected entirely with no variants.
// ─────────────────────────────────────────────────────────────────

evaluate({
  task: supportPrompt,
  data: supportCases,
  variants: { candidate: { model: 'x' } },
  baseline: 'candidate',
})

evaluate({
  task: supportPrompt,
  data: supportCases,
  variants: { candidate: { model: 'x' } },
  // @ts-expect-error — baseline must name a declared variant
  baseline: 'typo',
})

evaluate({
  task: supportPrompt,
  data: supportCases,
  // @ts-expect-error — baseline requires variants
  baseline: 'default',
})

// ─────────────────────────────────────────────────────────────────
// 10. Gate keys are linked to literal scorer names: known key accepted,
//     unknown key rejected when all scorer names are literal.
// ─────────────────────────────────────────────────────────────────

evaluate({
  task: summaryPrompt,
  data: textCases,
  scorers: [scorers.judge({ name: 'helpful', rubric: 'Is the answer helpful?' })],
  gates: { passRate: { min: 0.9 }, scores: { helpful: { min: 0.7 }, pass: { min: 1 } } },
})

evaluate({
  task: summaryPrompt,
  data: textCases,
  scorers: [scorers.judge({ name: 'helpful', rubric: 'Is the answer helpful?' })],
  gates: {
    scores: {
      // @ts-expect-error — unknown gate key when all scorer names are literal
      helpfull: { min: 0.7 },
    },
  },
})

// ─────────────────────────────────────────────────────────────────
// 11. Mixed literal + plain-function scorers degrade gate keys to `string`
//     (accepts anything — no false errors).
// ─────────────────────────────────────────────────────────────────

const adHocScorer = (args: { input: unknown; output: unknown; expected: unknown }) => ({
  name: 'adhoc',
  score: args.output === undefined ? null : 1,
})

evaluate({
  task: summaryPrompt,
  data: textCases,
  scorers: [scorers.judge({ name: 'helpful', rubric: 'Helpful?' }), adHocScorer],
  gates: { scores: { anythingGoes: { min: 0.5 } } },
})

// Factory-lambda scorers + gates MUST compile together (the rung-3 pattern).
// Gate keys degrade to `string` at the type level for the factory spelling
// (the factory's names resolve after `gates` is contextually typed);
// evaluate() validates them at definition time instead.
evaluate({
  task: summaryPrompt,
  data: textCases,
  scorers: (s) => [s.judge({ name: 'helpful', rubric: 'Helpful?' })],
  gates: { scores: { helpful: { min: 0.7 } } },
})

// ─────────────────────────────────────────────────────────────────
// 12. `judge` without `select` is rejected for object-output tasks and
//     accepted for string-output tasks.
// ─────────────────────────────────────────────────────────────────

evaluate({
  task: summaryPrompt,
  data: textCases,
  scorers: [scorers.judge({ name: 'tone', rubric: 'Professional tone?' })],
})

evaluate({
  task: supportPrompt,
  data: supportCases,
  scorers: (s) => [
    // @ts-expect-error — judge requires a typed `select` for non-string outputs
    s.judge({ name: 'helpful', rubric: 'Helpful?' }),
  ],
})

evaluate({
  task: supportPrompt,
  data: supportCases,
  scorers: (s) => [
    s.judge({
      name: 'helpful',
      rubric: 'Helpful?',
      select: (output) => {
        expectTypeOf(output).toEqualTypeOf<{ answer: string; confidence: number }>()
        return output.answer
      },
    }),
  ],
})

// ─────────────────────────────────────────────────────────────────
// 13. `turns` accepted on agent tasks; compile error on prompt tasks.
// ─────────────────────────────────────────────────────────────────

evaluate({
  task: supportAgent,
  data: [{ input: { question: 'hi', locale: 'en' } }, { turns: [{ user: 'hello' }, { user: 'I want a refund' }] }],
})

evaluate({
  task: supportPrompt,
  data: [
    {
      input: { question: 'hi', locale: 'en' },
      // @ts-expect-error — prompts are single-turn; turns require a steps-capturing task
      turns: [{ user: 'hello' }],
    },
  ],
})

// ─────────────────────────────────────────────────────────────────
// 14. dataset() row types flow from the schema into ctx (input and expected).
// ─────────────────────────────────────────────────────────────────

const goldenSet = dataset('golden/support.jsonl', {
  input: z.object({ question: z.string(), locale: z.enum(['en', 'nl']) }),
  expected: z.object({ answer: z.string() }),
})

evaluate({
  task: supportPrompt,
  data: goldenSet,
  expect: (ctx) => {
    expectTypeOf(ctx.expected).toEqualTypeOf<{ answer: string } | undefined>()
  },
})

const incompatibleSet = dataset('golden/other.jsonl', {
  input: z.object({ topic: z.string() }),
})

evaluate({
  task: supportPrompt,
  // @ts-expect-error — dataset rows are not assignable to the task input
  data: incompatibleSet,
})

// ─────────────────────────────────────────────────────────────────
// 15. CaseOf<typeof task> round-trips through `satisfies` extraction.
// ─────────────────────────────────────────────────────────────────

const sharedCases = [
  { input: { question: 'q1', locale: 'en' }, expected: { answer: 'a1', confidence: 1 } },
  { input: { question: 'q2', locale: 'nl' } },
] satisfies CaseOf<typeof supportPrompt, { answer: string; confidence: number }>[]

evaluate({ task: supportPrompt, data: sharedCases })

// ─────────────────────────────────────────────────────────────────
// 16. Experiment generics: perCase[number].output is OutputOf<T>;
//     aggregates keyed by scorer names (+ the lowered 'pass' score).
// ─────────────────────────────────────────────────────────────────

const bakeoff = evaluate({
  task: supportPrompt,
  data: supportCases,
  scorers: (s) => [s.judge({ name: 'helpful', rubric: 'Helpful?', select: (output) => output.answer })],
  variants: { candidate: { prompt: compatiblePrompt } },
  baseline: 'candidate',
})

type BakeoffExperiment = Awaited<ReturnType<typeof bakeoff.run>>

expectTypeOf<BakeoffExperiment['perCase'][number]['output']>().toEqualTypeOf<
  { answer: string; confidence: number } | undefined
>()
expectTypeOf<BakeoffExperiment['perCase'][number]['input']>().toEqualTypeOf<{
  question: string
  locale: 'en' | 'nl'
}>()
expectTypeOf<keyof BakeoffExperiment['aggregates']['perVariant']['candidate']['scores']>().toEqualTypeOf<
  'helpful' | 'pass'
>()

void bakeoff.run({ variants: ['candidate'] })

void bakeoff.run({
  // @ts-expect-error — run() variant filters are typed by the declared variant names
  variants: ['nope'],
})
