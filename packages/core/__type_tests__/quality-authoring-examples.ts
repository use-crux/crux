/**
 * Docs-style examples for the Quality authoring surface, ladder-ordered.
 * These are the snippets the documentation teaches — kept here so they are
 * guaranteed to compile against the real exports (Phase 1 acceptance;
 * extended to the full docs snippet set in Phase 7).
 *
 * Every TypeScript snippet on the Quality guide/reference pages and in the
 * README's Quality section has a compiled counterpart here. When editing the
 * docs, change this file first — if it stops compiling, the docs are wrong.
 *
 * Type-checked only; never executed.
 */

import { z } from 'zod'
import { prompt } from '../define'
import { context } from '../context'
import { config } from '../config'
import { agent } from '../agent/agent'
import { flow } from '../flow/scope'
import { retriever } from '../retrieval'
import { evaluate, target, scorers, dataset, cassette } from '../quality'
import type { CaseOf, GenerateFn } from '../quality'

const supportPrompt = prompt({
  id: 'support',
  input: z.object({ question: z.string(), locale: z.enum(['en', 'nl']) }),
  output: z.object({ answer: z.string(), confidence: z.number() }),
  system: 'You answer support questions precisely.',
})

const candidatePrompt = prompt({
  id: 'support-v2',
  input: z.object({ question: z.string() }),
  output: z.object({ answer: z.string(), confidence: z.number() }),
  system: 'You answer support questions precisely and concisely.',
})

const supportAgent = agent({ id: 'support-agent', prompt: supportPrompt })

// ─────────────────────────────────────────────────────────────────
// Rung 0 — colocated prompt tests: data-only cases on the prompt
// itself; the runner lowers them into a `prompt:<id>` evaluation.
// ─────────────────────────────────────────────────────────────────

export const triagePrompt = prompt({
  id: 'support-triage',
  input: z.object({ message: z.string() }),
  output: z.object({ queue: z.enum(['billing', 'technical', 'other']) }),
  system: 'Route the message to the right support queue.',
  tests: [
    { input: { message: 'My invoice is wrong' }, expected: { queue: 'billing' } },
    { name: 'vague message', input: { message: 'It is broken' } },
  ],
})

// ─────────────────────────────────────────────────────────────────
// Rung 1 (quickstart) — a plain function task. Inference flows from
// the fn signature; `expected` in data types `ctx.expected`.
// ─────────────────────────────────────────────────────────────────

export const quickstart = evaluate({
  task: (input: { word: string }) => input.word.toUpperCase(),
  data: [
    { input: { word: 'crux' }, expected: 'CRUX' },
    { input: { word: 'quality' }, expected: 'QUALITY' },
  ],
  expect: (ctx) => {
    if (ctx.expected !== undefined) ctx.expect(ctx.output).toBe(ctx.expected)
  },
})

// ─────────────────────────────────────────────────────────────────
// Rung 1 — task + data. A valid smoke run; outputs are recorded.
// ─────────────────────────────────────────────────────────────────

export const smoke = evaluate({
  task: supportPrompt,
  data: [
    { input: { question: 'How do refunds work?', locale: 'en' } },
    { input: { question: 'Hoe werkt een refund?', locale: 'nl' } },
  ],
})

// ─────────────────────────────────────────────────────────────────
// Rung 2 — evaluation-level expect: shared assertions, honest signals.
// ─────────────────────────────────────────────────────────────────

export const asserted = evaluate({
  task: supportPrompt,
  data: [{ input: { question: 'How do refunds work?', locale: 'en' }, expected: { mustMention: 'refund' } }],
  expect: (ctx) => {
    ctx.expect(ctx.output.answer).toContain(String(ctx.expected?.mustMention ?? ''))
    ctx.expect(ctx.output.confidence).toBeGreaterThanOrEqual(0.5)
    ctx.expect.latency.toBeUnderMs(5000)
    ctx.expect.safety.toHavePassedGuardrails()
  },
})

// ─────────────────────────────────────────────────────────────────
// Rung 3 — scorers + gates (structured output → factory-bound judge).
// ─────────────────────────────────────────────────────────────────

export const gated = evaluate('support.quality-bar', {
  task: supportPrompt,
  data: dataset('golden/support.jsonl', {
    input: z.object({ question: z.string(), locale: z.enum(['en', 'nl']) }),
    expected: z.object({ answer: z.string() }),
  }),
  scorers: (s) => [
    s.judge({ name: 'helpful', rubric: 'Does the answer resolve the question?', select: (o) => o.answer }),
    s.levenshtein(),
  ],
  gates: { passRate: { min: 0.95 }, scores: { helpful: { min: 0.7 } } },
})

// ─────────────────────────────────────────────────────────────────
// Rung 4 — variants, baseline, trials: a real bakeoff.
// ─────────────────────────────────────────────────────────────────

export const bakeoff = evaluate('support.bakeoff', {
  task: target.prompt(supportPrompt, { model: 'gpt-5' }),
  data: [{ input: { question: 'How do refunds work?', locale: 'en' } }],
  scorers: (s) => [s.judge({ name: 'helpful', rubric: 'Helpful?', select: (o) => o.answer })],
  variants: {
    current: {},
    candidate: { prompt: candidatePrompt },
    cheap: { model: 'gpt-5-mini' },
  },
  baseline: 'current',
  trials: 3,
  gates: { scores: { helpful: { minDeltaVsBaseline: -0.02 } } },
})

// ─────────────────────────────────────────────────────────────────
// Rung 5 — agents, tool mocks, trajectory assertions, replay.
// ─────────────────────────────────────────────────────────────────

export const agentLoop = evaluate('support.agent-loop', {
  task: target.agent(supportAgent, {
    tools: { lookupOrder: { status: 'shipped' } },
    maxToolSteps: 8,
  }),
  data: [
    { input: { question: 'Where is my order?', locale: 'en' } },
    { turns: [{ user: 'Hi' }, { user: 'I want a refund for order 1234' }] },
  ],
  expect: (ctx) => {
    ctx.expect.toolCalls.toHaveCalled('lookupOrder')
    ctx.expect.toolCalls.toMatchTrajectory('subset', [{ tool: 'lookupOrder' }])
    ctx.expect.handoffs.count().toBeLessThanOrEqual(1)
  },
  replay: { mode: 'replay-strict', cassette: cassette('support-agent') },
})

// ─────────────────────────────────────────────────────────────────
// Extraction — the one-annotation escape hatch for shared case arrays.
// ─────────────────────────────────────────────────────────────────

export const sharedCases = [
  { input: { question: 'How do refunds work?', locale: 'en' }, expected: { answer: 'Within 14 days.' } },
] satisfies CaseOf<typeof supportPrompt, { answer: string }>[]

export const fromShared = evaluate({
  task: supportPrompt,
  data: sharedCases,
  scorers: [scorers.contains()],
})

// ─────────────────────────────────────────────────────────────────
// Vitest bridge — the one-liner (run() executes once the engine lands).
// ─────────────────────────────────────────────────────────────────

export async function vitestBridge(): Promise<boolean> {
  const experiment = await gated.run()
  return experiment.passed
}

// Run overrides: subset runs for local iteration (gates demote to
// informational on filtered runs — never promote one).
export async function focusedRun(): Promise<void> {
  await bakeoff.run({ variants: ['current', 'candidate'], replayMode: 'replay-strict' })
  await gated.run({ cases: ['refund-*'], trials: 1 })
}

// Promotion: make a finished experiment the committed reference.
export async function promoteCurrent(): Promise<string> {
  const experiment = await bakeoff.run()
  const { baselineId } = await experiment.promote({ variant: 'current' })
  return baselineId
}

// ─────────────────────────────────────────────────────────────────
// Soft assertions and ad-hoc scores.
// ─────────────────────────────────────────────────────────────────

export const diagnosed = evaluate({
  task: supportPrompt,
  data: [{ input: { question: 'How do refunds work?', locale: 'en' } }],
  expect: (ctx) => {
    // soft: record the failure, keep running the rest of the callback
    ctx.expect.soft(ctx.output.answer).toContain('refund')
    ctx.expect.soft(ctx.output.answer).toContain('14 days')
    // ad-hoc per-case score — joins the same score model as scorers
    ctx.score('answer-length', Math.min(1, ctx.output.answer.length / 200))
  },
})

// ─────────────────────────────────────────────────────────────────
// Signal namespaces — the kitchen-sink agent example the docs cite.
// ─────────────────────────────────────────────────────────────────

export const signalShowcase = evaluate({
  task: supportAgent,
  data: [{ input: { question: 'Where is my order?', locale: 'en' } }],
  expect: (ctx) => {
    ctx.expect.latency.toBeUnderMs(5000)
    ctx.expect.cost.toBeUnderUsd(0.05)
    ctx.expect.errors.toHaveNone()
    ctx.expect.toolCalls.toHaveCalled('lookupOrder', { orderId: '1234' })
    ctx.expect.toolCalls.toHaveCalledBefore('search', 'write')
    ctx.expect.steps.toHaveOrder('plan', 'write')
    ctx.expect.handoffs.toHaveHandedOffTo('escalation-agent')
    ctx.expect.retrieval.toContainHit({ sourceId: 'kb-refunds' })
    ctx.expect.citations.toAllResolve()
    ctx.expect.safety.toHaveBlocked('pii-guardrail')
    ctx.expect.memory.toHaveWritten('customer-sentiment')
    ctx.expect.routing.toHaveSelectedModel('gpt-5-mini')
    ctx.expect.modelCalls.count().toBeLessThanOrEqual(3)
  },
})

// ─────────────────────────────────────────────────────────────────
// Judge variations: choiceScores classification; judge mixed with a
// plain custom scorer fn in the factory form.
// ─────────────────────────────────────────────────────────────────

export const judged = evaluate('support.relevance', {
  task: supportPrompt,
  data: [{ input: { question: 'How do refunds work?', locale: 'en' } }],
  scorers: (s) => [
    s.judge({ name: 'relevance', rubric: 'Does the answer address the question?', select: (o) => o.answer }),
    s.judge({
      name: 'tone',
      choiceScores: { professional: 1, neutral: 0.6, rude: 0 },
      select: (o) => o.answer,
    }),
    async ({ output }) => ({
      name: 'answered',
      score: output.answer.length > 0 ? 1 : 0,
    }),
  ],
  gates: { scores: { relevance: { min: 0.8 } } },
})

// ─────────────────────────────────────────────────────────────────
// Recipe: flow — typed input, step assertions, per-step overrides.
// ─────────────────────────────────────────────────────────────────

const researchFlow = flow<{ summary: string }, { topic: string }>('research', async (f) => {
  const sources = await f.step('search', async () => [`results for ${f.input.topic}`])
  return f.step('write', async () => ({ summary: sources.join('\n') }))
})

export const flowEval = evaluate('research.pipeline', {
  task: target.flow(researchFlow, { steps: { write: { model: 'gpt-5-mini' } } }),
  data: [{ input: { topic: 'refunds' } }],
  expect: (ctx) => {
    ctx.expect.steps.toHaveOrder('search', 'write')
    ctx.expect.steps.toHaveSucceeded('write')
    // step output is unknown until narrowed with a Standard Schema
    const write = ctx.step('write', z.object({ summary: z.string() }))
    ctx.expect(write.output.summary.length).toBeGreaterThan(0)
    ctx.expect(ctx.output.summary).toContain('refunds')
  },
})

// ─────────────────────────────────────────────────────────────────
// Recipe: retriever — retrieval assertions + ranking scorers.
// The retrieval scorers read `expected: { sources: [...] }`.
// ─────────────────────────────────────────────────────────────────

const docsRetriever = retriever({
  id: 'docs',
  namespace: 'kb',
  retrieve: async (query) => [
    {
      namespace: 'kb',
      sourceId: 'kb-refunds',
      chunkId: 'kb-refunds#0',
      content: `Refund policy for: ${query}`,
      metadata: {},
      score: 0.92,
    },
  ],
})

export const retrievalEval = evaluate('docs.retrieval', {
  task: target.retriever(docsRetriever),
  data: [
    {
      input: { query: 'how do refunds work' },
      expected: { sources: [{ sourceId: 'kb-refunds' }] },
    },
  ],
  expect: (ctx) => {
    ctx.expect.retrieval.toContainHit({ sourceId: 'kb-refunds' })
    ctx.expect.retrieval.count().toBeGreaterThan(0)
  },
  scorers: [scorers.retrieval.recallAtK(5), scorers.retrieval.mrr()],
})

// ─────────────────────────────────────────────────────────────────
// Recipe: RAG — judge-backed faithfulness/relevancy over a pipeline
// that retrieves and answers. Retrieved context comes from captured
// retrieval signals (or `input.context` as a fallback).
// ─────────────────────────────────────────────────────────────────

export const ragEval = evaluate('docs.rag', {
  task: async (input: { question: string }) => {
    const hits = await docsRetriever.retrieve(input.question)
    return { answer: hits.map((h) => h.content).join('\n'), sources: hits.map((h) => h.sourceId) }
  },
  data: [{ input: { question: 'How do refunds work?' } }],
  scorers: (s) => [s.rag.faithfulness(), s.rag.answerRelevancy()],
})

// ─────────────────────────────────────────────────────────────────
// Recipe: context variant — same I/O contract, one prompt grounded
// with a static context; the bakeoff measures what grounding buys.
// ─────────────────────────────────────────────────────────────────

const refundPolicy = context({
  id: 'refund-policy',
  system: 'Refunds are accepted within 14 days of purchase.',
})

const groundedPrompt = prompt({
  id: 'support-grounded',
  input: z.object({ question: z.string(), locale: z.enum(['en', 'nl']) }),
  output: z.object({ answer: z.string(), confidence: z.number() }),
  system: 'You answer support questions precisely.',
  use: [refundPolicy],
})

export const contextBakeoff = evaluate('support.context-bakeoff', {
  task: supportPrompt,
  data: [{ input: { question: 'How do refunds work?', locale: 'en' } }],
  variants: {
    ungrounded: {},
    grounded: { prompt: groundedPrompt },
  },
  baseline: 'ungrounded',
  scorers: (s) => [s.judge({ name: 'grounded-answer', rubric: 'Is the answer specific about policy?', select: (o) => o.answer })],
  gates: { scores: { 'grounded-answer': { minDeltaVsBaseline: 0 } } },
})

// ─────────────────────────────────────────────────────────────────
// Project configuration — the `quality:` block of crux.config.ts.
// (Docs show `generate` coming from an adapter such as @crux/ai.)
// ─────────────────────────────────────────────────────────────────

declare const adapterGenerate: GenerateFn

export const qualityConfigured = config({
  prompts: [supportPrompt, groundedPrompt],
  quality: {
    include: 'evals/**/*.eval.ts',
    dir: '.crux/quality',
    setup: async () => ({
      generate: adapterGenerate,
      model: 'openai/gpt-5-mini',
      models: { fast: 'openai/gpt-5-mini', smart: 'openai/gpt-5' },
      judgeModel: 'openai/gpt-5',
    }),
    redact: ['input.customerEmail'],
    defaults: { trials: 1, timeoutMs: 60_000, replay: 'replay-strict' },
  },
})
