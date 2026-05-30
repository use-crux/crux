import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'
import { prompt as makePrompt } from '../../define'
import { flowEvaluation, isFlowEvalDef } from '../../testing'
import type { FlowStepDef, FlowEvalCase, FlowModelConfig, FlowTrace, GenerateFn } from '../../testing'
import { executeFlow } from '../../flow/executor'

// ─────────────────────────────────────────────────────────────────
// Mock AI SDK
// ─────────────────────────────────────────────────────────────────

const mockGenerateText = vi.fn()
const mockTool = vi.fn((config: any) => config)
const mockStepCountIs = vi.fn((n: number) => `stepCountIs(${n})`)

vi.mock('ai', () => ({
  generateText: (...args: any[]) => mockGenerateText(...args),
  tool: (...args: any[]) => mockTool(...args),
  stepCountIs: (...args: any[]) => mockStepCountIs(...args),
}))

// ─────────────────────────────────────────────────────────────────
// Test Fixtures
// ─────────────────────────────────────────────────────────────────

const textPrompt = makePrompt({
  id: 'test-text',
  system: 'You are a tester.',
  prompt: 'Test this.',
})

const structuredPrompt = makePrompt({
  id: 'test-structured',
  input: z.object({ query: z.string() }),
  output: z.object({ answer: z.string() }),
  system: ({ input }) => `Answer: ${input.query}`,
})

const agentPrompt = makePrompt({
  id: 'test-agent',
  system: 'You are an agent with tools.',
  prompt: 'Help the user.',
})

const mockGenerate: GenerateFn = vi.fn(async (prompt, opts) => {
  if (prompt.hasOutput) {
    return {
      object: {
        answer: `Response to: ${(opts.input as any)?.query ?? 'unknown'}`,
      },
      text: '',
      _meta: {
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        cost: 0.001,
      },
    }
  }
  return {
    text: `Generated text for ${prompt.id}`,
    _meta: {
      usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 },
      cost: 0.0005,
    },
  }
})

const fakeModel = { modelId: 'test-model', provider: 'test' }

beforeEach(() => {
  vi.clearAllMocks()
})

// ─────────────────────────────────────────────────────────────────
// flowEvaluation & isFlowEvalDef
// ─────────────────────────────────────────────────────────────────

describe('flowEvaluation', () => {
  it('returns the config as-is', () => {
    const def = flowEvaluation({
      name: 'test-flow',
      steps: [{ id: 'a', prompt: textPrompt }],
      configs: [{ name: 'default', models: { a: fakeModel } }],
      cases: [{ name: 'case-1', input: {}, assert: () => true }],
    })

    expect(def.name).toBe('test-flow')
    expect(def.steps).toHaveLength(1)
    expect(def.configs).toHaveLength(1)
    expect(def.cases).toHaveLength(1)
  })
})

describe('isFlowEvalDef', () => {
  it('returns true for valid FlowEvalDef', () => {
    const def = flowEvaluation({
      name: 'test',
      steps: [{ id: 'a', prompt: textPrompt }],
      configs: [{ name: 'default', models: { a: fakeModel } }],
      cases: [{ name: 'c', input: {}, assert: () => true }],
    })
    expect(isFlowEvalDef(def)).toBe(true)
  })

  it('returns false for non-objects', () => {
    expect(isFlowEvalDef(null)).toBe(false)
    expect(isFlowEvalDef(undefined)).toBe(false)
    expect(isFlowEvalDef('string')).toBe(false)
    expect(isFlowEvalDef(42)).toBe(false)
  })

  it('returns false for incomplete objects', () => {
    expect(isFlowEvalDef({ name: 'x' })).toBe(false)
    expect(isFlowEvalDef({ name: 'x', steps: [] })).toBe(false)
    expect(isFlowEvalDef({ name: 'x', steps: [{}], configs: [], cases: [] })).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────
// executeFlow — Plain Steps
// ─────────────────────────────────────────────────────────────────

describe('executeFlow — plain steps', () => {
  it('executes a single plain step', async () => {
    const trace = await executeFlow({
      steps: [{ id: 'step1', prompt: textPrompt }],
      evalCase: { name: 'test', input: {}, assert: () => true },
      config: { name: 'default', models: { step1: fakeModel } },
      generate: mockGenerate,
    })

    expect(trace.configName).toBe('default')
    expect(trace.error).toBeUndefined()
    const step = trace.step('step1')
    expect(step.skipped).toBe(false)
    expect(step.text).toBe('Generated text for test-text')
    expect(step.durationMs).toBeGreaterThanOrEqual(0)
    expect(mockGenerate).toHaveBeenCalledOnce()
  })

  it('executes a chain of plain steps with input forwarding', async () => {
    const trace = await executeFlow({
      steps: [
        { id: 'plan', prompt: structuredPrompt },
        {
          id: 'validate',
          prompt: textPrompt,
          input: (ctx) => ({
            previousAnswer: ctx.step('plan').output.answer,
          }),
        },
      ],
      evalCase: { name: 'test', input: { query: 'hello' }, assert: () => true },
      config: {
        name: 'default',
        models: { plan: fakeModel, validate: fakeModel },
      },
      generate: mockGenerate,
    })

    expect(trace.error).toBeUndefined()
    expect(Object.keys(trace.stepResults)).toHaveLength(2)

    // First step gets case.input
    expect(mockGenerate).toHaveBeenNthCalledWith(1, structuredPrompt, {
      model: fakeModel,
      input: { query: 'hello' },
    })

    // Second step gets transformed input from first step
    expect(mockGenerate).toHaveBeenNthCalledWith(2, textPrompt, {
      model: fakeModel,
      input: { previousAnswer: 'Response to: hello' },
    })
  })

  it('aggregates usage and cost across steps', async () => {
    const trace = await executeFlow({
      steps: [
        { id: 'a', prompt: textPrompt },
        { id: 'b', prompt: textPrompt },
      ],
      evalCase: { name: 'test', input: {}, assert: () => true },
      config: { name: 'default', models: { a: fakeModel, b: fakeModel } },
      generate: mockGenerate,
    })

    expect(trace.totalUsage.totalTokens).toBe(24) // 12 + 12
    expect(trace.totalCost).toBe(0.001) // 0.0005 + 0.0005
  })

  it('records error when step fails', async () => {
    const failingGenerate: GenerateFn = vi.fn(async () => {
      throw new Error('Model unavailable')
    })

    const trace = await executeFlow({
      steps: [{ id: 'step1', prompt: textPrompt }],
      evalCase: { name: 'test', input: {}, assert: () => true },
      config: { name: 'default', models: { step1: fakeModel } },
      generate: failingGenerate,
    })

    expect(trace.error).toContain('Model unavailable')
  })

  it('throws when accessing non-existent step', async () => {
    const trace = await executeFlow({
      steps: [{ id: 'step1', prompt: textPrompt }],
      evalCase: { name: 'test', input: {}, assert: () => true },
      config: { name: 'default', models: { step1: fakeModel } },
      generate: mockGenerate,
    })

    expect(() => trace.step('nonexistent')).toThrow(/does not exist/)
  })

  it('errors when model not configured for step', async () => {
    const trace = await executeFlow({
      steps: [{ id: 'step1', prompt: textPrompt }],
      evalCase: { name: 'test', input: {}, assert: () => true },
      config: { name: 'default', models: {} },
      generate: mockGenerate,
    })

    expect(trace.error).toContain('No model configured for step "step1"')
  })
})

// ─────────────────────────────────────────────────────────────────
// executeFlow — Skip Logic
// ─────────────────────────────────────────────────────────────────

describe('executeFlow — skip logic', () => {
  it('skips steps when skip predicate returns true', async () => {
    const trace = await executeFlow({
      steps: [
        { id: 'always', prompt: textPrompt },
        {
          id: 'maybe',
          prompt: textPrompt,
          skip: (ctx) => !ctx.case.input?.brandVoice,
        },
        {
          id: 'after',
          prompt: textPrompt,
          input: () => ({ fromSkipped: true }),
        },
      ],
      evalCase: { name: 'test', input: {}, assert: () => true },
      config: {
        name: 'default',
        models: { always: fakeModel, maybe: fakeModel, after: fakeModel },
      },
      generate: mockGenerate,
    })

    expect(trace.step('always').skipped).toBe(false)
    expect(trace.step('maybe').skipped).toBe(true)
    expect(trace.step('maybe').durationMs).toBe(0)
    expect(trace.step('after').skipped).toBe(false)

    // Only 2 generate calls (skipped step doesn't generate)
    expect(mockGenerate).toHaveBeenCalledTimes(2)
  })

  it('does not skip when predicate returns false', async () => {
    const trace = await executeFlow({
      steps: [
        {
          id: 'step1',
          prompt: textPrompt,
          skip: () => false,
        },
      ],
      evalCase: { name: 'test', input: {}, assert: () => true },
      config: { name: 'default', models: { step1: fakeModel } },
      generate: mockGenerate,
    })

    expect(trace.step('step1').skipped).toBe(false)
    expect(mockGenerate).toHaveBeenCalledOnce()
  })

  it('skipped steps do not count in usage aggregation', async () => {
    const trace = await executeFlow({
      steps: [
        { id: 'a', prompt: textPrompt },
        { id: 'b', prompt: textPrompt, skip: () => true },
      ],
      evalCase: { name: 'test', input: {}, assert: () => true },
      config: { name: 'default', models: { a: fakeModel, b: fakeModel } },
      generate: mockGenerate,
    })

    expect(trace.totalUsage.totalTokens).toBe(12) // only step a
  })
})

// ─────────────────────────────────────────────────────────────────
// executeFlow — Tool-Calling Steps
// ─────────────────────────────────────────────────────────────────

describe('executeFlow — tool-calling steps', () => {
  it('calls generateText with tools for tool-calling steps', async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: 'I called the research tool.',
      steps: [
        {
          toolCalls: [{ toolName: 'research', args: { query: 'test' } }],
          toolResults: [{ toolName: 'research', result: { findings: 'found stuff' } }],
        },
        { toolCalls: [], toolResults: [] },
      ],
      usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
    })

    const trace = await executeFlow({
      steps: [
        {
          id: 'agent',
          prompt: agentPrompt,
          tools: [
            {
              name: 'research',
              description: 'Search for content',
              parameters: z.object({ query: z.string() }),
            },
          ],
          toolMocks: {
            research: { findings: 'found stuff' },
          },
          maxToolSteps: 10,
        },
      ],
      evalCase: {
        name: 'test',
        input: { userMessage: 'Research something' },
        assert: () => true,
      },
      config: { name: 'default', models: { agent: fakeModel } },
      generate: mockGenerate,
    })

    expect(trace.error).toBeUndefined()
    const step = trace.step('agent')
    expect(step.toolCalls).toHaveLength(1)
    expect(step.toolCalls![0].name).toBe('research')
    expect(step.toolCalls![0].args).toEqual({ query: 'test' })
    expect(step.toolStepCount).toBe(2)
    expect(step.text).toBe('I called the research tool.')

    // Should NOT have called the adapter generate
    expect(mockGenerate).not.toHaveBeenCalled()
    // Should have called generateText from AI SDK
    expect(mockGenerateText).toHaveBeenCalledOnce()
  })

  it('builds tool set with mock implementations', async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: 'Done.',
      steps: [],
      usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
    })

    await executeFlow({
      steps: [
        {
          id: 'agent',
          prompt: agentPrompt,
          tools: [
            {
              name: 'myTool',
              description: 'A test tool',
              parameters: z.object({ x: z.number() }),
            },
          ],
          toolMocks: {
            myTool: (args: any) => ({ result: args.x * 2 }),
          },
        },
      ],
      evalCase: {
        name: 'test',
        input: { userMessage: 'Use myTool' },
        assert: () => true,
      },
      config: { name: 'default', models: { agent: fakeModel } },
      generate: mockGenerate,
    })

    // Verify tool was built
    expect(mockTool).toHaveBeenCalledOnce()
    const toolConfig = mockTool.mock.calls[0][0]
    expect(toolConfig.description).toBe('A test tool')
    expect(toolConfig.inputSchema).toBeDefined()
    expect(typeof toolConfig.execute).toBe('function')
  })
})

// ─────────────────────────────────────────────────────────────────
// executeFlow — Multiturn Steps
// ─────────────────────────────────────────────────────────────────

describe('executeFlow — multiturn steps', () => {
  it('executes multiple turns with accumulated history', async () => {
    mockGenerateText
      .mockResolvedValueOnce({
        text: 'I found some research.',
        steps: [
          {
            toolCalls: [{ toolName: 'research', args: { query: 'landing pages' } }],
            toolResults: [{ toolName: 'research', result: { findings: 'tips' } }],
          },
          { toolCalls: [], toolResults: [] },
        ],
        usage: { inputTokens: 15, outputTokens: 8, totalTokens: 23 },
      })
      .mockResolvedValueOnce({
        text: 'I wrote the intro.',
        steps: [
          {
            toolCalls: [{ toolName: 'writer', args: { instruction: 'Write intro' } }],
            toolResults: [{ toolName: 'writer', result: { written: true } }],
          },
          { toolCalls: [], toolResults: [] },
        ],
        usage: { inputTokens: 25, outputTokens: 12, totalTokens: 37 },
      })

    const trace = await executeFlow({
      steps: [
        {
          id: 'agent',
          prompt: agentPrompt,
          tools: [
            {
              name: 'research',
              description: 'Research',
              parameters: z.object({ query: z.string() }),
            },
            {
              name: 'writer',
              description: 'Write',
              parameters: z.object({ instruction: z.string() }),
            },
          ],
          toolMocks: {
            research: { findings: 'tips' },
            writer: { written: true },
          },
          maxToolSteps: 15,
        },
      ],
      evalCase: {
        name: 'multiturn-test',
        turns: [{ userMessage: 'Research landing pages' }, { userMessage: 'Now write an intro' }],
        assert: () => true,
      },
      config: { name: 'default', models: { agent: fakeModel } },
      generate: mockGenerate,
    })

    expect(trace.error).toBeUndefined()
    const step = trace.step('agent')
    expect(step.turnCount).toBe(2)
    expect(step.turns).toHaveLength(2)
    expect(step.turns![0].userMessage).toBe('Research landing pages')
    expect(step.turns![0].response).toBe('I found some research.')
    expect(step.turns![0].toolCalls).toHaveLength(1)
    expect(step.turns![0].toolCalls[0].name).toBe('research')
    expect(step.turns![1].userMessage).toBe('Now write an intro')
    expect(step.turns![1].response).toBe('I wrote the intro.')
    expect(step.turns![1].toolCalls[0].name).toBe('writer')
    expect(step.totalToolStepCount).toBe(4) // 2 steps per turn
    expect(step.toolCalls).toHaveLength(2) // flattened across turns

    // generateText should be called twice (once per turn)
    expect(mockGenerateText).toHaveBeenCalledTimes(2)

    // Second call should include conversation history from first turn
    const secondCallArgs = mockGenerateText.mock.calls[1][0]
    expect(secondCallArgs.messages).toHaveLength(3) // user1 + assistant1 + user2
    expect(secondCallArgs.messages[0].role).toBe('user')
    expect(secondCallArgs.messages[0].content).toBe('Research landing pages')
    expect(secondCallArgs.messages[1].role).toBe('assistant')
    expect(secondCallArgs.messages[1].content).toBe('I found some research.')
    expect(secondCallArgs.messages[2].role).toBe('user')
    expect(secondCallArgs.messages[2].content).toBe('Now write an intro')

    // Aggregated usage
    expect(trace.totalUsage.totalTokens).toBe(60) // 23 + 37
  })

  it('runs intermediate assertions between turns', async () => {
    const intermediateAssert = vi.fn(() => true)

    mockGenerateText
      .mockResolvedValueOnce({
        text: 'Research done.',
        steps: [
          {
            toolCalls: [{ toolName: 'research', args: { q: 'test' } }],
            toolResults: [{ toolName: 'research', result: {} }],
          },
        ],
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      })
      .mockResolvedValueOnce({
        text: 'Writing done.',
        steps: [],
        usage: { inputTokens: 12, outputTokens: 6, totalTokens: 18 },
      })

    await executeFlow({
      steps: [
        {
          id: 'agent',
          prompt: agentPrompt,
          tools: [
            {
              name: 'research',
              description: 'R',
              parameters: z.object({ q: z.string() }),
            },
          ],
          toolMocks: { research: {} },
        },
      ],
      evalCase: {
        name: 'test',
        turns: [
          {
            userMessage: 'Research first',
            assert: intermediateAssert,
          },
          { userMessage: 'Then write' },
        ],
        assert: () => true,
      },
      config: { name: 'default', models: { agent: fakeModel } },
      generate: mockGenerate,
    })

    expect(intermediateAssert).toHaveBeenCalledOnce()
    const trace = intermediateAssert.mock.calls[0][0] as FlowTrace
    expect(trace.step('agent').turns).toHaveLength(1)
  })

  it('fails when intermediate assertion returns false', async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: 'Bad response.',
      steps: [],
      usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
    })

    const trace = await executeFlow({
      steps: [
        {
          id: 'agent',
          prompt: agentPrompt,
          tools: [{ name: 'tool1', description: 'T', parameters: z.object({}) }],
          toolMocks: { tool1: {} },
        },
      ],
      evalCase: {
        name: 'test',
        turns: [
          {
            userMessage: 'Do something',
            assert: () => false,
          },
          { userMessage: 'Follow up' },
        ],
        assert: () => true,
      },
      config: { name: 'default', models: { agent: fakeModel } },
      generate: mockGenerate,
    })

    expect(trace.error).toContain('Intermediate assertion failed')
    // Second turn should not have been executed
    expect(mockGenerateText).toHaveBeenCalledOnce()
  })
})