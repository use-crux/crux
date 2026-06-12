/**
 * Compile-perf fixture: 50 representative evaluations across all task kinds.
 * Consumed by __tests__/quality/compile-perf.test.ts, which compiles this file
 * with  (tsconfig.perf.json) and asserts the
 * instantiation count stays within the recorded budget. GENERATED ONCE —
 * edit deliberately; perf numbers move with every change here.
 */

import { z } from 'zod'
import { prompt } from '../../define'
import { agent } from '../../agent/agent'
import { flow } from '../../flow/scope'
import { evaluate, target, scorers } from '../../quality/api'


const structured0 = prompt({
  id: 'fixture-structured-0',
  input: z.object({ question: z.string(), tier: z.enum(['free', 'pro']), index: z.number() }),
  output: z.object({ answer: z.string(), confidence: z.number(), tags: z.array(z.string()) }),
  system: 'Fixture prompt 0.',
})

const text0 = prompt({
  id: 'fixture-text-0',
  input: z.object({ topic: z.string() }),
  system: 'Fixture text prompt 0.',
})

const agent0 = agent({ id: 'fixture-agent-0', prompt: structured0 })

const flow0 = flow<{ summary: string; score: number }, { topic: string }>('fixture-flow-0', async () => ({
  summary: '',
  score: 0,
}))

const structured1 = prompt({
  id: 'fixture-structured-1',
  input: z.object({ question: z.string(), tier: z.enum(['free', 'pro']), index: z.number() }),
  output: z.object({ answer: z.string(), confidence: z.number(), tags: z.array(z.string()) }),
  system: 'Fixture prompt 1.',
})

const text1 = prompt({
  id: 'fixture-text-1',
  input: z.object({ topic: z.string() }),
  system: 'Fixture text prompt 1.',
})

const agent1 = agent({ id: 'fixture-agent-1', prompt: structured1 })

const flow1 = flow<{ summary: string; score: number }, { topic: string }>('fixture-flow-1', async () => ({
  summary: '',
  score: 0,
}))

const structured2 = prompt({
  id: 'fixture-structured-2',
  input: z.object({ question: z.string(), tier: z.enum(['free', 'pro']), index: z.number() }),
  output: z.object({ answer: z.string(), confidence: z.number(), tags: z.array(z.string()) }),
  system: 'Fixture prompt 2.',
})

const text2 = prompt({
  id: 'fixture-text-2',
  input: z.object({ topic: z.string() }),
  system: 'Fixture text prompt 2.',
})

const agent2 = agent({ id: 'fixture-agent-2', prompt: structured2 })

const flow2 = flow<{ summary: string; score: number }, { topic: string }>('fixture-flow-2', async () => ({
  summary: '',
  score: 0,
}))

const structured3 = prompt({
  id: 'fixture-structured-3',
  input: z.object({ question: z.string(), tier: z.enum(['free', 'pro']), index: z.number() }),
  output: z.object({ answer: z.string(), confidence: z.number(), tags: z.array(z.string()) }),
  system: 'Fixture prompt 3.',
})

const text3 = prompt({
  id: 'fixture-text-3',
  input: z.object({ topic: z.string() }),
  system: 'Fixture text prompt 3.',
})

const agent3 = agent({ id: 'fixture-agent-3', prompt: structured3 })

const flow3 = flow<{ summary: string; score: number }, { topic: string }>('fixture-flow-3', async () => ({
  summary: '',
  score: 0,
}))

const structured4 = prompt({
  id: 'fixture-structured-4',
  input: z.object({ question: z.string(), tier: z.enum(['free', 'pro']), index: z.number() }),
  output: z.object({ answer: z.string(), confidence: z.number(), tags: z.array(z.string()) }),
  system: 'Fixture prompt 4.',
})

const text4 = prompt({
  id: 'fixture-text-4',
  input: z.object({ topic: z.string() }),
  system: 'Fixture text prompt 4.',
})

const agent4 = agent({ id: 'fixture-agent-4', prompt: structured4 })

const flow4 = flow<{ summary: string; score: number }, { topic: string }>('fixture-flow-4', async () => ({
  summary: '',
  score: 0,
}))

export const promptEval0 = evaluate('fixture.prompt.0', {
  task: structured0,
  data: [
    { input: { question: 'q0a', tier: 'free', index: 0 } },
    { input: { question: 'q0b', tier: 'pro', index: 0 }, expected: { answer: 'a0' }, trials: 2 },
  ],
  expect: (ctx) => {
    ctx.expect(ctx.output.answer).toBeDefined()
    ctx.expect(ctx.output.confidence).toBeGreaterThan(0)
    ctx.expect.latency.toBeUnderMs(4000)
  },
  scorers: (s) => [s.judge({ name: 'helpful0', rubric: 'Helpful?', select: (o) => o.answer }), s.exact()],
  variants: { cheap: { model: 'mini' }, hot: { settings: { temperature: 0.9 } } },
  baseline: 'cheap',
  gates: { passRate: { min: 0.9 }, scores: { ['helpful0']: { min: 0.7 } } },
})

export const promptEval1 = evaluate('fixture.prompt.1', {
  task: structured1,
  data: [
    { input: { question: 'q1a', tier: 'free', index: 1 } },
    { input: { question: 'q1b', tier: 'pro', index: 1 }, expected: { answer: 'a1' }, trials: 2 },
  ],
  expect: (ctx) => {
    ctx.expect(ctx.output.answer).toBeDefined()
    ctx.expect(ctx.output.confidence).toBeGreaterThan(0)
    ctx.expect.latency.toBeUnderMs(4000)
  },
  scorers: (s) => [s.judge({ name: 'helpful1', rubric: 'Helpful?', select: (o) => o.answer }), s.exact()],
  variants: { cheap: { model: 'mini' }, hot: { settings: { temperature: 0.9 } } },
  baseline: 'cheap',
  gates: { passRate: { min: 0.9 }, scores: { ['helpful1']: { min: 0.7 } } },
})

export const promptEval2 = evaluate('fixture.prompt.2', {
  task: structured2,
  data: [
    { input: { question: 'q2a', tier: 'free', index: 2 } },
    { input: { question: 'q2b', tier: 'pro', index: 2 }, expected: { answer: 'a2' }, trials: 2 },
  ],
  expect: (ctx) => {
    ctx.expect(ctx.output.answer).toBeDefined()
    ctx.expect(ctx.output.confidence).toBeGreaterThan(0)
    ctx.expect.latency.toBeUnderMs(4000)
  },
  scorers: (s) => [s.judge({ name: 'helpful2', rubric: 'Helpful?', select: (o) => o.answer }), s.exact()],
  variants: { cheap: { model: 'mini' }, hot: { settings: { temperature: 0.9 } } },
  baseline: 'cheap',
  gates: { passRate: { min: 0.9 }, scores: { ['helpful2']: { min: 0.7 } } },
})

export const promptEval3 = evaluate('fixture.prompt.3', {
  task: structured3,
  data: [
    { input: { question: 'q3a', tier: 'free', index: 3 } },
    { input: { question: 'q3b', tier: 'pro', index: 3 }, expected: { answer: 'a3' }, trials: 2 },
  ],
  expect: (ctx) => {
    ctx.expect(ctx.output.answer).toBeDefined()
    ctx.expect(ctx.output.confidence).toBeGreaterThan(0)
    ctx.expect.latency.toBeUnderMs(4000)
  },
  scorers: (s) => [s.judge({ name: 'helpful3', rubric: 'Helpful?', select: (o) => o.answer }), s.exact()],
  variants: { cheap: { model: 'mini' }, hot: { settings: { temperature: 0.9 } } },
  baseline: 'cheap',
  gates: { passRate: { min: 0.9 }, scores: { ['helpful3']: { min: 0.7 } } },
})

export const promptEval4 = evaluate('fixture.prompt.4', {
  task: structured4,
  data: [
    { input: { question: 'q4a', tier: 'free', index: 4 } },
    { input: { question: 'q4b', tier: 'pro', index: 4 }, expected: { answer: 'a4' }, trials: 2 },
  ],
  expect: (ctx) => {
    ctx.expect(ctx.output.answer).toBeDefined()
    ctx.expect(ctx.output.confidence).toBeGreaterThan(0)
    ctx.expect.latency.toBeUnderMs(4000)
  },
  scorers: (s) => [s.judge({ name: 'helpful4', rubric: 'Helpful?', select: (o) => o.answer }), s.exact()],
  variants: { cheap: { model: 'mini' }, hot: { settings: { temperature: 0.9 } } },
  baseline: 'cheap',
  gates: { passRate: { min: 0.9 }, scores: { ['helpful4']: { min: 0.7 } } },
})

export const promptEval5 = evaluate('fixture.prompt.5', {
  task: structured0,
  data: [
    { input: { question: 'q5a', tier: 'free', index: 5 } },
    { input: { question: 'q5b', tier: 'pro', index: 5 }, expected: { answer: 'a5' }, trials: 2 },
  ],
  expect: (ctx) => {
    ctx.expect(ctx.output.answer).toBeDefined()
    ctx.expect(ctx.output.confidence).toBeGreaterThan(0)
    ctx.expect.latency.toBeUnderMs(4000)
  },
  scorers: (s) => [s.judge({ name: 'helpful5', rubric: 'Helpful?', select: (o) => o.answer }), s.exact()],
  variants: { cheap: { model: 'mini' }, hot: { settings: { temperature: 0.9 } } },
  baseline: 'cheap',
  gates: { passRate: { min: 0.9 }, scores: { ['helpful5']: { min: 0.7 } } },
})

export const promptEval6 = evaluate('fixture.prompt.6', {
  task: structured1,
  data: [
    { input: { question: 'q6a', tier: 'free', index: 6 } },
    { input: { question: 'q6b', tier: 'pro', index: 6 }, expected: { answer: 'a6' }, trials: 2 },
  ],
  expect: (ctx) => {
    ctx.expect(ctx.output.answer).toBeDefined()
    ctx.expect(ctx.output.confidence).toBeGreaterThan(0)
    ctx.expect.latency.toBeUnderMs(4000)
  },
  scorers: (s) => [s.judge({ name: 'helpful6', rubric: 'Helpful?', select: (o) => o.answer }), s.exact()],
  variants: { cheap: { model: 'mini' }, hot: { settings: { temperature: 0.9 } } },
  baseline: 'cheap',
  gates: { passRate: { min: 0.9 }, scores: { ['helpful6']: { min: 0.7 } } },
})

export const promptEval7 = evaluate('fixture.prompt.7', {
  task: structured2,
  data: [
    { input: { question: 'q7a', tier: 'free', index: 7 } },
    { input: { question: 'q7b', tier: 'pro', index: 7 }, expected: { answer: 'a7' }, trials: 2 },
  ],
  expect: (ctx) => {
    ctx.expect(ctx.output.answer).toBeDefined()
    ctx.expect(ctx.output.confidence).toBeGreaterThan(0)
    ctx.expect.latency.toBeUnderMs(4000)
  },
  scorers: (s) => [s.judge({ name: 'helpful7', rubric: 'Helpful?', select: (o) => o.answer }), s.exact()],
  variants: { cheap: { model: 'mini' }, hot: { settings: { temperature: 0.9 } } },
  baseline: 'cheap',
  gates: { passRate: { min: 0.9 }, scores: { ['helpful7']: { min: 0.7 } } },
})

export const promptEval8 = evaluate('fixture.prompt.8', {
  task: structured3,
  data: [
    { input: { question: 'q8a', tier: 'free', index: 8 } },
    { input: { question: 'q8b', tier: 'pro', index: 8 }, expected: { answer: 'a8' }, trials: 2 },
  ],
  expect: (ctx) => {
    ctx.expect(ctx.output.answer).toBeDefined()
    ctx.expect(ctx.output.confidence).toBeGreaterThan(0)
    ctx.expect.latency.toBeUnderMs(4000)
  },
  scorers: (s) => [s.judge({ name: 'helpful8', rubric: 'Helpful?', select: (o) => o.answer }), s.exact()],
  variants: { cheap: { model: 'mini' }, hot: { settings: { temperature: 0.9 } } },
  baseline: 'cheap',
  gates: { passRate: { min: 0.9 }, scores: { ['helpful8']: { min: 0.7 } } },
})

export const promptEval9 = evaluate('fixture.prompt.9', {
  task: structured4,
  data: [
    { input: { question: 'q9a', tier: 'free', index: 9 } },
    { input: { question: 'q9b', tier: 'pro', index: 9 }, expected: { answer: 'a9' }, trials: 2 },
  ],
  expect: (ctx) => {
    ctx.expect(ctx.output.answer).toBeDefined()
    ctx.expect(ctx.output.confidence).toBeGreaterThan(0)
    ctx.expect.latency.toBeUnderMs(4000)
  },
  scorers: (s) => [s.judge({ name: 'helpful9', rubric: 'Helpful?', select: (o) => o.answer }), s.exact()],
  variants: { cheap: { model: 'mini' }, hot: { settings: { temperature: 0.9 } } },
  baseline: 'cheap',
  gates: { passRate: { min: 0.9 }, scores: { ['helpful9']: { min: 0.7 } } },
})

export const promptEval10 = evaluate('fixture.prompt.10', {
  task: structured0,
  data: [
    { input: { question: 'q10a', tier: 'free', index: 10 } },
    { input: { question: 'q10b', tier: 'pro', index: 10 }, expected: { answer: 'a10' }, trials: 2 },
  ],
  expect: (ctx) => {
    ctx.expect(ctx.output.answer).toBeDefined()
    ctx.expect(ctx.output.confidence).toBeGreaterThan(0)
    ctx.expect.latency.toBeUnderMs(4000)
  },
  scorers: (s) => [s.judge({ name: 'helpful10', rubric: 'Helpful?', select: (o) => o.answer }), s.exact()],
  variants: { cheap: { model: 'mini' }, hot: { settings: { temperature: 0.9 } } },
  baseline: 'cheap',
  gates: { passRate: { min: 0.9 }, scores: { ['helpful10']: { min: 0.7 } } },
})

export const promptEval11 = evaluate('fixture.prompt.11', {
  task: structured1,
  data: [
    { input: { question: 'q11a', tier: 'free', index: 11 } },
    { input: { question: 'q11b', tier: 'pro', index: 11 }, expected: { answer: 'a11' }, trials: 2 },
  ],
  expect: (ctx) => {
    ctx.expect(ctx.output.answer).toBeDefined()
    ctx.expect(ctx.output.confidence).toBeGreaterThan(0)
    ctx.expect.latency.toBeUnderMs(4000)
  },
  scorers: (s) => [s.judge({ name: 'helpful11', rubric: 'Helpful?', select: (o) => o.answer }), s.exact()],
  variants: { cheap: { model: 'mini' }, hot: { settings: { temperature: 0.9 } } },
  baseline: 'cheap',
  gates: { passRate: { min: 0.9 }, scores: { ['helpful11']: { min: 0.7 } } },
})

export const promptEval12 = evaluate('fixture.prompt.12', {
  task: structured2,
  data: [
    { input: { question: 'q12a', tier: 'free', index: 12 } },
    { input: { question: 'q12b', tier: 'pro', index: 12 }, expected: { answer: 'a12' }, trials: 2 },
  ],
  expect: (ctx) => {
    ctx.expect(ctx.output.answer).toBeDefined()
    ctx.expect(ctx.output.confidence).toBeGreaterThan(0)
    ctx.expect.latency.toBeUnderMs(4000)
  },
  scorers: (s) => [s.judge({ name: 'helpful12', rubric: 'Helpful?', select: (o) => o.answer }), s.exact()],
  variants: { cheap: { model: 'mini' }, hot: { settings: { temperature: 0.9 } } },
  baseline: 'cheap',
  gates: { passRate: { min: 0.9 }, scores: { ['helpful12']: { min: 0.7 } } },
})

export const promptEval13 = evaluate('fixture.prompt.13', {
  task: structured3,
  data: [
    { input: { question: 'q13a', tier: 'free', index: 13 } },
    { input: { question: 'q13b', tier: 'pro', index: 13 }, expected: { answer: 'a13' }, trials: 2 },
  ],
  expect: (ctx) => {
    ctx.expect(ctx.output.answer).toBeDefined()
    ctx.expect(ctx.output.confidence).toBeGreaterThan(0)
    ctx.expect.latency.toBeUnderMs(4000)
  },
  scorers: (s) => [s.judge({ name: 'helpful13', rubric: 'Helpful?', select: (o) => o.answer }), s.exact()],
  variants: { cheap: { model: 'mini' }, hot: { settings: { temperature: 0.9 } } },
  baseline: 'cheap',
  gates: { passRate: { min: 0.9 }, scores: { ['helpful13']: { min: 0.7 } } },
})

export const promptEval14 = evaluate('fixture.prompt.14', {
  task: structured4,
  data: [
    { input: { question: 'q14a', tier: 'free', index: 14 } },
    { input: { question: 'q14b', tier: 'pro', index: 14 }, expected: { answer: 'a14' }, trials: 2 },
  ],
  expect: (ctx) => {
    ctx.expect(ctx.output.answer).toBeDefined()
    ctx.expect(ctx.output.confidence).toBeGreaterThan(0)
    ctx.expect.latency.toBeUnderMs(4000)
  },
  scorers: (s) => [s.judge({ name: 'helpful14', rubric: 'Helpful?', select: (o) => o.answer }), s.exact()],
  variants: { cheap: { model: 'mini' }, hot: { settings: { temperature: 0.9 } } },
  baseline: 'cheap',
  gates: { passRate: { min: 0.9 }, scores: { ['helpful14']: { min: 0.7 } } },
})

export const promptEval15 = evaluate('fixture.prompt.15', {
  task: structured0,
  data: [
    { input: { question: 'q15a', tier: 'free', index: 15 } },
    { input: { question: 'q15b', tier: 'pro', index: 15 }, expected: { answer: 'a15' }, trials: 2 },
  ],
  expect: (ctx) => {
    ctx.expect(ctx.output.answer).toBeDefined()
    ctx.expect(ctx.output.confidence).toBeGreaterThan(0)
    ctx.expect.latency.toBeUnderMs(4000)
  },
  scorers: (s) => [s.judge({ name: 'helpful15', rubric: 'Helpful?', select: (o) => o.answer }), s.exact()],
  variants: { cheap: { model: 'mini' }, hot: { settings: { temperature: 0.9 } } },
  baseline: 'cheap',
  gates: { passRate: { min: 0.9 }, scores: { ['helpful15']: { min: 0.7 } } },
})

export const promptEval16 = evaluate('fixture.prompt.16', {
  task: structured1,
  data: [
    { input: { question: 'q16a', tier: 'free', index: 16 } },
    { input: { question: 'q16b', tier: 'pro', index: 16 }, expected: { answer: 'a16' }, trials: 2 },
  ],
  expect: (ctx) => {
    ctx.expect(ctx.output.answer).toBeDefined()
    ctx.expect(ctx.output.confidence).toBeGreaterThan(0)
    ctx.expect.latency.toBeUnderMs(4000)
  },
  scorers: (s) => [s.judge({ name: 'helpful16', rubric: 'Helpful?', select: (o) => o.answer }), s.exact()],
  variants: { cheap: { model: 'mini' }, hot: { settings: { temperature: 0.9 } } },
  baseline: 'cheap',
  gates: { passRate: { min: 0.9 }, scores: { ['helpful16']: { min: 0.7 } } },
})

export const promptEval17 = evaluate('fixture.prompt.17', {
  task: structured2,
  data: [
    { input: { question: 'q17a', tier: 'free', index: 17 } },
    { input: { question: 'q17b', tier: 'pro', index: 17 }, expected: { answer: 'a17' }, trials: 2 },
  ],
  expect: (ctx) => {
    ctx.expect(ctx.output.answer).toBeDefined()
    ctx.expect(ctx.output.confidence).toBeGreaterThan(0)
    ctx.expect.latency.toBeUnderMs(4000)
  },
  scorers: (s) => [s.judge({ name: 'helpful17', rubric: 'Helpful?', select: (o) => o.answer }), s.exact()],
  variants: { cheap: { model: 'mini' }, hot: { settings: { temperature: 0.9 } } },
  baseline: 'cheap',
  gates: { passRate: { min: 0.9 }, scores: { ['helpful17']: { min: 0.7 } } },
})

export const promptEval18 = evaluate('fixture.prompt.18', {
  task: structured3,
  data: [
    { input: { question: 'q18a', tier: 'free', index: 18 } },
    { input: { question: 'q18b', tier: 'pro', index: 18 }, expected: { answer: 'a18' }, trials: 2 },
  ],
  expect: (ctx) => {
    ctx.expect(ctx.output.answer).toBeDefined()
    ctx.expect(ctx.output.confidence).toBeGreaterThan(0)
    ctx.expect.latency.toBeUnderMs(4000)
  },
  scorers: (s) => [s.judge({ name: 'helpful18', rubric: 'Helpful?', select: (o) => o.answer }), s.exact()],
  variants: { cheap: { model: 'mini' }, hot: { settings: { temperature: 0.9 } } },
  baseline: 'cheap',
  gates: { passRate: { min: 0.9 }, scores: { ['helpful18']: { min: 0.7 } } },
})

export const promptEval19 = evaluate('fixture.prompt.19', {
  task: structured4,
  data: [
    { input: { question: 'q19a', tier: 'free', index: 19 } },
    { input: { question: 'q19b', tier: 'pro', index: 19 }, expected: { answer: 'a19' }, trials: 2 },
  ],
  expect: (ctx) => {
    ctx.expect(ctx.output.answer).toBeDefined()
    ctx.expect(ctx.output.confidence).toBeGreaterThan(0)
    ctx.expect.latency.toBeUnderMs(4000)
  },
  scorers: (s) => [s.judge({ name: 'helpful19', rubric: 'Helpful?', select: (o) => o.answer }), s.exact()],
  variants: { cheap: { model: 'mini' }, hot: { settings: { temperature: 0.9 } } },
  baseline: 'cheap',
  gates: { passRate: { min: 0.9 }, scores: { ['helpful19']: { min: 0.7 } } },
})

export const textEval0 = evaluate('fixture.text.0', {
  task: text0,
  data: [{ input: { topic: 'topic0' } }],
  scorers: [scorers.judge({ name: 'tone0', rubric: 'Professional?' }), scorers.contains()],
  gates: { scores: { ['tone0']: { min: 0.6 } } },
})

export const textEval1 = evaluate('fixture.text.1', {
  task: text1,
  data: [{ input: { topic: 'topic1' } }],
  scorers: [scorers.judge({ name: 'tone1', rubric: 'Professional?' }), scorers.contains()],
  gates: { scores: { ['tone1']: { min: 0.6 } } },
})

export const textEval2 = evaluate('fixture.text.2', {
  task: text2,
  data: [{ input: { topic: 'topic2' } }],
  scorers: [scorers.judge({ name: 'tone2', rubric: 'Professional?' }), scorers.contains()],
  gates: { scores: { ['tone2']: { min: 0.6 } } },
})

export const textEval3 = evaluate('fixture.text.3', {
  task: text3,
  data: [{ input: { topic: 'topic3' } }],
  scorers: [scorers.judge({ name: 'tone3', rubric: 'Professional?' }), scorers.contains()],
  gates: { scores: { ['tone3']: { min: 0.6 } } },
})

export const textEval4 = evaluate('fixture.text.4', {
  task: text4,
  data: [{ input: { topic: 'topic4' } }],
  scorers: [scorers.judge({ name: 'tone4', rubric: 'Professional?' }), scorers.contains()],
  gates: { scores: { ['tone4']: { min: 0.6 } } },
})

export const textEval5 = evaluate('fixture.text.5', {
  task: text0,
  data: [{ input: { topic: 'topic5' } }],
  scorers: [scorers.judge({ name: 'tone5', rubric: 'Professional?' }), scorers.contains()],
  gates: { scores: { ['tone5']: { min: 0.6 } } },
})

export const textEval6 = evaluate('fixture.text.6', {
  task: text1,
  data: [{ input: { topic: 'topic6' } }],
  scorers: [scorers.judge({ name: 'tone6', rubric: 'Professional?' }), scorers.contains()],
  gates: { scores: { ['tone6']: { min: 0.6 } } },
})

export const textEval7 = evaluate('fixture.text.7', {
  task: text2,
  data: [{ input: { topic: 'topic7' } }],
  scorers: [scorers.judge({ name: 'tone7', rubric: 'Professional?' }), scorers.contains()],
  gates: { scores: { ['tone7']: { min: 0.6 } } },
})

export const textEval8 = evaluate('fixture.text.8', {
  task: text3,
  data: [{ input: { topic: 'topic8' } }],
  scorers: [scorers.judge({ name: 'tone8', rubric: 'Professional?' }), scorers.contains()],
  gates: { scores: { ['tone8']: { min: 0.6 } } },
})

export const textEval9 = evaluate('fixture.text.9', {
  task: text4,
  data: [{ input: { topic: 'topic9' } }],
  scorers: [scorers.judge({ name: 'tone9', rubric: 'Professional?' }), scorers.contains()],
  gates: { scores: { ['tone9']: { min: 0.6 } } },
})

export const agentEval0 = evaluate('fixture.agent.0', {
  task: target.agent(agent0, { tools: { search: { ok: true } }, maxToolSteps: 6 }),
  data: [
    { input: { question: 'aq0', tier: 'pro', index: 0 } },
    { turns: [{ user: 'hello' }, { user: 'help 0' }] },
  ],
  expect: (ctx) => {
    ctx.expect.toolCalls.toHaveCalled('search')
    ctx.expect.steps.count().toBeGreaterThan(0)
    ctx.expect.handoffs.count().toBeLessThanOrEqual(2)
  },
})

export const agentEval1 = evaluate('fixture.agent.1', {
  task: target.agent(agent1, { tools: { search: { ok: true } }, maxToolSteps: 6 }),
  data: [
    { input: { question: 'aq1', tier: 'pro', index: 1 } },
    { turns: [{ user: 'hello' }, { user: 'help 1' }] },
  ],
  expect: (ctx) => {
    ctx.expect.toolCalls.toHaveCalled('search')
    ctx.expect.steps.count().toBeGreaterThan(0)
    ctx.expect.handoffs.count().toBeLessThanOrEqual(2)
  },
})

export const agentEval2 = evaluate('fixture.agent.2', {
  task: target.agent(agent2, { tools: { search: { ok: true } }, maxToolSteps: 6 }),
  data: [
    { input: { question: 'aq2', tier: 'pro', index: 2 } },
    { turns: [{ user: 'hello' }, { user: 'help 2' }] },
  ],
  expect: (ctx) => {
    ctx.expect.toolCalls.toHaveCalled('search')
    ctx.expect.steps.count().toBeGreaterThan(0)
    ctx.expect.handoffs.count().toBeLessThanOrEqual(2)
  },
})

export const agentEval3 = evaluate('fixture.agent.3', {
  task: target.agent(agent3, { tools: { search: { ok: true } }, maxToolSteps: 6 }),
  data: [
    { input: { question: 'aq3', tier: 'pro', index: 3 } },
    { turns: [{ user: 'hello' }, { user: 'help 3' }] },
  ],
  expect: (ctx) => {
    ctx.expect.toolCalls.toHaveCalled('search')
    ctx.expect.steps.count().toBeGreaterThan(0)
    ctx.expect.handoffs.count().toBeLessThanOrEqual(2)
  },
})

export const agentEval4 = evaluate('fixture.agent.4', {
  task: target.agent(agent4, { tools: { search: { ok: true } }, maxToolSteps: 6 }),
  data: [
    { input: { question: 'aq4', tier: 'pro', index: 4 } },
    { turns: [{ user: 'hello' }, { user: 'help 4' }] },
  ],
  expect: (ctx) => {
    ctx.expect.toolCalls.toHaveCalled('search')
    ctx.expect.steps.count().toBeGreaterThan(0)
    ctx.expect.handoffs.count().toBeLessThanOrEqual(2)
  },
})

export const agentEval5 = evaluate('fixture.agent.5', {
  task: target.agent(agent0, { tools: { search: { ok: true } }, maxToolSteps: 6 }),
  data: [
    { input: { question: 'aq5', tier: 'pro', index: 5 } },
    { turns: [{ user: 'hello' }, { user: 'help 5' }] },
  ],
  expect: (ctx) => {
    ctx.expect.toolCalls.toHaveCalled('search')
    ctx.expect.steps.count().toBeGreaterThan(0)
    ctx.expect.handoffs.count().toBeLessThanOrEqual(2)
  },
})

export const agentEval6 = evaluate('fixture.agent.6', {
  task: target.agent(agent1, { tools: { search: { ok: true } }, maxToolSteps: 6 }),
  data: [
    { input: { question: 'aq6', tier: 'pro', index: 6 } },
    { turns: [{ user: 'hello' }, { user: 'help 6' }] },
  ],
  expect: (ctx) => {
    ctx.expect.toolCalls.toHaveCalled('search')
    ctx.expect.steps.count().toBeGreaterThan(0)
    ctx.expect.handoffs.count().toBeLessThanOrEqual(2)
  },
})

export const agentEval7 = evaluate('fixture.agent.7', {
  task: target.agent(agent2, { tools: { search: { ok: true } }, maxToolSteps: 6 }),
  data: [
    { input: { question: 'aq7', tier: 'pro', index: 7 } },
    { turns: [{ user: 'hello' }, { user: 'help 7' }] },
  ],
  expect: (ctx) => {
    ctx.expect.toolCalls.toHaveCalled('search')
    ctx.expect.steps.count().toBeGreaterThan(0)
    ctx.expect.handoffs.count().toBeLessThanOrEqual(2)
  },
})

export const agentEval8 = evaluate('fixture.agent.8', {
  task: target.agent(agent3, { tools: { search: { ok: true } }, maxToolSteps: 6 }),
  data: [
    { input: { question: 'aq8', tier: 'pro', index: 8 } },
    { turns: [{ user: 'hello' }, { user: 'help 8' }] },
  ],
  expect: (ctx) => {
    ctx.expect.toolCalls.toHaveCalled('search')
    ctx.expect.steps.count().toBeGreaterThan(0)
    ctx.expect.handoffs.count().toBeLessThanOrEqual(2)
  },
})

export const agentEval9 = evaluate('fixture.agent.9', {
  task: target.agent(agent4, { tools: { search: { ok: true } }, maxToolSteps: 6 }),
  data: [
    { input: { question: 'aq9', tier: 'pro', index: 9 } },
    { turns: [{ user: 'hello' }, { user: 'help 9' }] },
  ],
  expect: (ctx) => {
    ctx.expect.toolCalls.toHaveCalled('search')
    ctx.expect.steps.count().toBeGreaterThan(0)
    ctx.expect.handoffs.count().toBeLessThanOrEqual(2)
  },
})

export const flowEval0 = evaluate('fixture.flow.0', {
  task: flow0,
  data: [{ input: { topic: 'flow-topic-0' } }],
  expect: (ctx) => {
    ctx.expect(ctx.output.summary).toBeTypeOf('string')
    ctx.expect.steps.toHaveRun('plan')
  },
  variants: { tuned: { steps: { plan: { model: 'mini' } } } },
})

export const flowEval1 = evaluate('fixture.flow.1', {
  task: flow1,
  data: [{ input: { topic: 'flow-topic-1' } }],
  expect: (ctx) => {
    ctx.expect(ctx.output.summary).toBeTypeOf('string')
    ctx.expect.steps.toHaveRun('plan')
  },
  variants: { tuned: { steps: { plan: { model: 'mini' } } } },
})

export const flowEval2 = evaluate('fixture.flow.2', {
  task: flow2,
  data: [{ input: { topic: 'flow-topic-2' } }],
  expect: (ctx) => {
    ctx.expect(ctx.output.summary).toBeTypeOf('string')
    ctx.expect.steps.toHaveRun('plan')
  },
  variants: { tuned: { steps: { plan: { model: 'mini' } } } },
})

export const flowEval3 = evaluate('fixture.flow.3', {
  task: flow3,
  data: [{ input: { topic: 'flow-topic-3' } }],
  expect: (ctx) => {
    ctx.expect(ctx.output.summary).toBeTypeOf('string')
    ctx.expect.steps.toHaveRun('plan')
  },
  variants: { tuned: { steps: { plan: { model: 'mini' } } } },
})

export const flowEval4 = evaluate('fixture.flow.4', {
  task: flow4,
  data: [{ input: { topic: 'flow-topic-4' } }],
  expect: (ctx) => {
    ctx.expect(ctx.output.summary).toBeTypeOf('string')
    ctx.expect.steps.toHaveRun('plan')
  },
  variants: { tuned: { steps: { plan: { model: 'mini' } } } },
})

export const fnEval0 = evaluate('fixture.fn.0', {
  task: async (input: { text: string }, params: { threshold: number }) => input.text.length > params.threshold,
  data: [{ input: { text: 'sample 0' }, expected: true }],
  params: { threshold: 0 },
  variants: { strict: { threshold: 100 } },
  scorers: [scorers.exact()],
})

export const fnEval1 = evaluate('fixture.fn.1', {
  task: async (input: { text: string }, params: { threshold: number }) => input.text.length > params.threshold,
  data: [{ input: { text: 'sample 1' }, expected: true }],
  params: { threshold: 1 },
  variants: { strict: { threshold: 100 } },
  scorers: [scorers.exact()],
})

export const fnEval2 = evaluate('fixture.fn.2', {
  task: async (input: { text: string }, params: { threshold: number }) => input.text.length > params.threshold,
  data: [{ input: { text: 'sample 2' }, expected: true }],
  params: { threshold: 2 },
  variants: { strict: { threshold: 100 } },
  scorers: [scorers.exact()],
})

export const fnEval3 = evaluate('fixture.fn.3', {
  task: async (input: { text: string }, params: { threshold: number }) => input.text.length > params.threshold,
  data: [{ input: { text: 'sample 3' }, expected: true }],
  params: { threshold: 3 },
  variants: { strict: { threshold: 100 } },
  scorers: [scorers.exact()],
})

export const fnEval4 = evaluate('fixture.fn.4', {
  task: async (input: { text: string }, params: { threshold: number }) => input.text.length > params.threshold,
  data: [{ input: { text: 'sample 4' }, expected: true }],
  params: { threshold: 4 },
  variants: { strict: { threshold: 100 } },
  scorers: [scorers.exact()],
})
