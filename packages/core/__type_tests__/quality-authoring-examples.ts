/**
 * Docs-style examples for the Quality authoring surface, ladder-ordered.
 * These are the snippets the documentation teaches — kept here so they are
 * guaranteed to compile against the real exports (Phase 1 acceptance).
 *
 * Type-checked only; never executed.
 */

import { z } from 'zod'
import { prompt } from '../define'
import { agent } from '../agent/agent'
import { evaluate, target, scorers, dataset, cassette } from '../quality/api'
import type { CaseOf } from '../quality/api'

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
