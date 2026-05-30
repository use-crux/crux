import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { prompt as makePrompt } from '../../define'
import { flowEvaluation } from '../../testing'
import { updateRuntime, resetRuntime } from '../../runtime'
import type { FlowEvalCaseResult, FlowEvalReporter, GenerateFn } from '../../testing'
import { evaluateFlow } from '../../flow/evaluator'

// ─────────────────────────────────────────────────────────────────
// Mock AI SDK (needed because executor imports from 'ai')
// ─────────────────────────────────────────────────────────────────

vi.mock('ai', () => ({
  generateText: vi.fn(),
  tool: vi.fn((config: any) => config),
  stepCountIs: vi.fn((n: number) => `stepCountIs(${n})`),
}))

// ─────────────────────────────────────────────────────────────────
// Test Fixtures
// ─────────────────────────────────────────────────────────────────

const textPrompt = makePrompt({
  id: 'eval-test',
  system: 'You are a tester.',
  prompt: 'Test this.',
})

const mockGenerate: GenerateFn = vi.fn(async () => ({
  text: 'Generated text.',
  _meta: {
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    cost: 0.001,
  },
}))

const fakeModel = { modelId: 'test-model', provider: 'test' }
const fakeModel2 = { modelId: 'test-model-2', provider: 'test' }

beforeEach(() => {
  vi.clearAllMocks()
  resetRuntime()
})

afterEach(() => {
  resetRuntime()
})

// ─────────────────────────────────────────────────────────────────
// evaluateFlow — Basic
// ─────────────────────────────────────────────────────────────────

describe('evaluateFlow — basic', () => {
  it('runs a single case × config and returns a report', async () => {
    const flowEval = flowEvaluation({
      name: 'basic-flow',
      steps: [{ id: 'step1', prompt: textPrompt }],
      configs: [{ name: 'default', models: { step1: fakeModel } }],
      cases: [
        {
          name: 'case-1',
          input: {},
          assert: (trace) => {
            return trace.step('step1').text === 'Generated text.'
          },
        },
      ],
    })

    const report = await evaluateFlow({ flowEval, generate: mockGenerate })

    expect(report.name).toBe('basic-flow')
    expect(report.results).toHaveLength(1)
    expect(report.results[0].caseName).toBe('case-1')
    expect(report.results[0].configName).toBe('default')
    expect(report.results[0].passed).toBe(true)
    expect(report.results[0].error).toBeUndefined()
    expect(report.results[0].durationMs).toBeGreaterThanOrEqual(0)
    expect(report.results[0].trace).toBeDefined()
  })

  it('records failure when assertion returns false', async () => {
    const flowEval = flowEvaluation({
      name: 'failing-flow',
      steps: [{ id: 'step1', prompt: textPrompt }],
      configs: [{ name: 'default', models: { step1: fakeModel } }],
      cases: [
        {
          name: 'fails',
          input: {},
          assert: () => false,
        },
      ],
    })

    const report = await evaluateFlow({ flowEval, generate: mockGenerate })

    expect(report.results[0].passed).toBe(false)
    expect(report.results[0].error).toBeUndefined() // assertion returned false, no thrown error
  })

  it('records error when assertion throws', async () => {
    const flowEval = flowEvaluation({
      name: 'error-flow',
      steps: [{ id: 'step1', prompt: textPrompt }],
      configs: [{ name: 'default', models: { step1: fakeModel } }],
      cases: [
        {
          name: 'throws',
          input: {},
          assert: () => {
            throw new Error('Assertion exploded')
          },
        },
      ],
    })

    const report = await evaluateFlow({ flowEval, generate: mockGenerate })

    expect(report.results[0].passed).toBe(false)
    expect(report.results[0].error).toContain('Assertion exploded')
  })

  it('records error when flow execution fails', async () => {
    const failingGenerate: GenerateFn = vi.fn(async () => {
      throw new Error('Model down')
    })

    const flowEval = flowEvaluation({
      name: 'exec-error',
      steps: [{ id: 'step1', prompt: textPrompt }],
      configs: [{ name: 'default', models: { step1: fakeModel } }],
      cases: [
        {
          name: 'error-case',
          input: {},
          assert: () => true,
        },
      ],
    })

    const report = await evaluateFlow({ flowEval, generate: failingGenerate })

    expect(report.results[0].passed).toBe(false)
    expect(report.results[0].error).toContain('Model down')
    expect(report.results[0].trace).toBeDefined()
  })
})

// ─────────────────────────────────────────────────────────────────
// evaluateFlow — Case × Config Matrix
// ─────────────────────────────────────────────────────────────────

describe('evaluateFlow — matrix', () => {
  it('runs all case × config combinations', async () => {
    const flowEval = flowEvaluation({
      name: 'matrix-flow',
      steps: [{ id: 'step1', prompt: textPrompt }],
      configs: [
        { name: 'config-a', models: { step1: fakeModel } },
        { name: 'config-b', models: { step1: fakeModel2 } },
      ],
      cases: [
        { name: 'case-1', input: {}, assert: () => true },
        { name: 'case-2', input: {}, assert: () => true },
      ],
    })

    const report = await evaluateFlow({ flowEval, generate: mockGenerate })

    // 2 configs × 2 cases = 4 results
    expect(report.results).toHaveLength(4)
    expect(mockGenerate).toHaveBeenCalledTimes(4)

    const combos = report.results.map((r) => `${r.configName}/${r.caseName}`)
    expect(combos).toContain('config-a/case-1')
    expect(combos).toContain('config-a/case-2')
    expect(combos).toContain('config-b/case-1')
    expect(combos).toContain('config-b/case-2')
  })

  it('tracks pass/fail per config in summary', async () => {
    const flowEval = flowEvaluation({
      name: 'per-config',
      steps: [{ id: 'step1', prompt: textPrompt }],
      configs: [
        { name: 'good', models: { step1: fakeModel } },
        { name: 'bad', models: { step1: fakeModel2 } },
      ],
      cases: [
        {
          name: 'c1',
          input: {},
          assert: (trace) => trace.configName === 'good',
        },
        {
          name: 'c2',
          input: {},
          assert: (trace) => trace.configName === 'good',
        },
      ],
    })

    const report = await evaluateFlow({ flowEval, generate: mockGenerate })

    expect(report.summary.total).toBe(4)
    expect(report.summary.passed).toBe(2)
    expect(report.summary.failed).toBe(2)
    expect(report.summary.byConfig.good).toEqual({
      total: 2,
      passed: 2,
      failed: 0,
    })
    expect(report.summary.byConfig.bad).toEqual({
      total: 2,
      passed: 0,
      failed: 2,
    })
  })
})

// ─────────────────────────────────────────────────────────────────
// evaluateFlow — Summary Aggregation
// ─────────────────────────────────────────────────────────────────

describe('evaluateFlow — summary', () => {
  it('aggregates steps, tokens, and cost', async () => {
    const flowEval = flowEvaluation({
      name: 'summary-flow',
      steps: [
        { id: 'a', prompt: textPrompt },
        { id: 'b', prompt: textPrompt },
      ],
      configs: [{ name: 'default', models: { a: fakeModel, b: fakeModel } }],
      cases: [{ name: 'c1', input: {}, assert: () => true }],
    })

    const report = await evaluateFlow({ flowEval, generate: mockGenerate })

    // 1 case with 2 steps
    expect(report.summary.totalSteps).toBe(2)
    expect(report.summary.avgSteps).toBe(2)
    // Each step: 15 tokens, 0.001 cost → 2 steps = 30 tokens, 0.002 cost
    expect(report.summary.totalTokens).toBe(30)
    expect(report.summary.totalCost).toBeCloseTo(0.002)
  })

  it('handles empty cases gracefully', async () => {
    const flowEval = flowEvaluation({
      name: 'empty',
      steps: [{ id: 'a', prompt: textPrompt }],
      configs: [{ name: 'default', models: { a: fakeModel } }],
      cases: [],
    })

    const report = await evaluateFlow({ flowEval, generate: mockGenerate })

    expect(report.results).toHaveLength(0)
    expect(report.summary.total).toBe(0)
    expect(report.summary.avgSteps).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────
// evaluateFlow — Concurrency
// ─────────────────────────────────────────────────────────────────

describe('evaluateFlow — concurrency', () => {
  it('respects concurrency limit', async () => {
    let maxConcurrent = 0
    let currentConcurrent = 0

    const slowGenerate: GenerateFn = vi.fn(async () => {
      currentConcurrent++
      maxConcurrent = Math.max(maxConcurrent, currentConcurrent)
      await new Promise((r) => setTimeout(r, 10))
      currentConcurrent--
      return {
        text: 'done',
        _meta: {
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          cost: 0,
        },
      }
    })

    const flowEval = flowEvaluation({
      name: 'concurrency-test',
      steps: [{ id: 's', prompt: textPrompt }],
      configs: [{ name: 'c', models: { s: fakeModel } }],
      cases: Array.from({ length: 6 }, (_, i) => ({
        name: `case-${i}`,
        input: {},
        assert: () => true,
      })),
    })

    await evaluateFlow({
      flowEval,
      generate: slowGenerate,
      concurrency: 2,
    })

    expect(maxConcurrent).toBeLessThanOrEqual(2)
    expect(slowGenerate).toHaveBeenCalledTimes(6)
  })

  it('uses flowEval.concurrency as default', async () => {
    let maxConcurrent = 0
    let currentConcurrent = 0

    const slowGenerate: GenerateFn = vi.fn(async () => {
      currentConcurrent++
      maxConcurrent = Math.max(maxConcurrent, currentConcurrent)
      await new Promise((r) => setTimeout(r, 10))
      currentConcurrent--
      return {
        text: 'done',
        _meta: {
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          cost: 0,
        },
      }
    })

    const flowEval = flowEvaluation({
      name: 'concurrency-default',
      concurrency: 1,
      steps: [{ id: 's', prompt: textPrompt }],
      configs: [{ name: 'c', models: { s: fakeModel } }],
      cases: Array.from({ length: 4 }, (_, i) => ({
        name: `case-${i}`,
        input: {},
        assert: () => true,
      })),
    })

    await evaluateFlow({ flowEval, generate: slowGenerate })

    expect(maxConcurrent).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────
// evaluateFlow — Callbacks
// ─────────────────────────────────────────────────────────────────

describe('evaluateFlow — callbacks', () => {
  it('fires onCaseComplete for each (case, config)', async () => {
    const onCaseComplete = vi.fn()

    const flowEval = flowEvaluation({
      name: 'callback-flow',
      steps: [{ id: 's', prompt: textPrompt }],
      configs: [{ name: 'c', models: { s: fakeModel } }],
      cases: [
        { name: 'c1', input: {}, assert: () => true },
        { name: 'c2', input: {}, assert: () => false },
      ],
    })

    await evaluateFlow({ flowEval, generate: mockGenerate, onCaseComplete })

    expect(onCaseComplete).toHaveBeenCalledTimes(2)

    const calls = onCaseComplete.mock.calls.map((c) => c[0] as FlowEvalCaseResult)
    expect(calls.find((r) => r.caseName === 'c1')?.passed).toBe(true)
    expect(calls.find((r) => r.caseName === 'c2')?.passed).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────
// evaluateFlow — Reporter Integration
// ─────────────────────────────────────────────────────────────────

describe('evaluateFlow — reporter', () => {
  it('calls reporter lifecycle methods', async () => {
    const reporter: FlowEvalReporter = {
      onStart: vi.fn(),
      onCase: vi.fn(),
      onEnd: vi.fn(),
    }
    updateRuntime({ flowEvalReporter: reporter })

    const flowEval = flowEvaluation({
      name: 'reported-flow',
      description: 'A test flow',
      steps: [{ id: 'step1', prompt: textPrompt }],
      configs: [{ name: 'cfg', models: { step1: fakeModel } }],
      cases: [
        { name: 'pass-case', input: {}, assert: () => true },
        { name: 'fail-case', input: {}, assert: () => false },
      ],
    })

    await evaluateFlow({ flowEval, generate: mockGenerate })

    // onStart
    expect(reporter.onStart).toHaveBeenCalledOnce()
    const startArg = (reporter.onStart as any).mock.calls[0][0]
    expect(startArg.name).toBe('reported-flow')
    expect(startArg.description).toBe('A test flow')
    expect(startArg.stepIds).toEqual(['step1'])
    expect(startArg.configNames).toEqual(['cfg'])
    expect(startArg.caseNames).toEqual(['pass-case', 'fail-case'])
    expect(startArg.totalCases).toBe(2)
    expect(startArg.flowId).toBeDefined()

    // onCase — called once per (case, config)
    expect(reporter.onCase).toHaveBeenCalledTimes(2)
    const caseCalls = (reporter.onCase as any).mock.calls.map((c: any) => c[0])
    const passCall = caseCalls.find((c: any) => c.caseName === 'pass-case')
    expect(passCall.passed).toBe(true)
    expect(passCall.configName).toBe('cfg')
    expect(passCall.traceSummary.stepCount).toBe(1)

    const failCall = caseCalls.find((c: any) => c.caseName === 'fail-case')
    expect(failCall.passed).toBe(false)

    // onEnd
    expect(reporter.onEnd).toHaveBeenCalledOnce()
    const endArg = (reporter.onEnd as any).mock.calls[0][0]
    expect(endArg.flowId).toBe(startArg.flowId)
    expect(endArg.durationMs).toBeGreaterThanOrEqual(0)
    expect(endArg.summary.total).toBe(2)
    expect(endArg.summary.passed).toBe(1)
    expect(endArg.summary.failed).toBe(1)
  })

  it('works without a reporter', async () => {
    // No reporter set — should not throw
    const flowEval = flowEvaluation({
      name: 'no-reporter',
      steps: [{ id: 's', prompt: textPrompt }],
      configs: [{ name: 'c', models: { s: fakeModel } }],
      cases: [{ name: 'c', input: {}, assert: () => true }],
    })

    const report = await evaluateFlow({ flowEval, generate: mockGenerate })
    expect(report.results).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────────
// evaluateFlow — Async Assertions
// ─────────────────────────────────────────────────────────────────

describe('evaluateFlow — async assertions', () => {
  it('supports async assert functions', async () => {
    const flowEval = flowEvaluation({
      name: 'async-assert',
      steps: [{ id: 's', prompt: textPrompt }],
      configs: [{ name: 'c', models: { s: fakeModel } }],
      cases: [
        {
          name: 'async-case',
          input: {},
          assert: async (trace) => {
            await new Promise((r) => setTimeout(r, 5))
            return trace.step('s').text === 'Generated text.'
          },
        },
      ],
    })

    const report = await evaluateFlow({ flowEval, generate: mockGenerate })
    expect(report.results[0].passed).toBe(true)
  })
})
