import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createBudgetManager } from '../../compaction/budget'
import { summarizeMessages } from '../../compaction/summarize'
import { CostLimitError, modelPricing, withCostTracking } from '../../cost'
import { prompt } from '../../prompt/prompt'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '../../observability'
import { orchestrateGenerate } from '../../generation/orchestrate'
import { applyPlugins } from '../../runtime/plugin'
import { getHooks, resetHooks, setHooks } from '../../runtime/runtime'
import { runWithExecutionContext } from '../../runtime/execution-context'

function install(plugin: ReturnType<ReturnType<typeof withCostTracking>['asPlugin']>) {
  const applied = applyPlugins([plugin], getHooks())
  setHooks(applied.hooks)
  return applied
}

function textPrompt() {
  return prompt({
    id: 'summarize',
    input: z.object({ text: z.string() }),
    prompt: ({ input }) => input.text,
  })
}

async function generateOnce(options: { cost?: number; model?: string; provider?: string }) {
  const p = textPrompt()
  return orchestrateGenerate(
    {
      promptId: p.id,
      promptConfig: p.config,
      preparedArgs: { model: options.model ?? 'gpt-4o' },
      input: { text: 'hello' },
      model: options.model ?? 'gpt-4o',
      provider: options.provider ?? 'openai',
      resolved: await p.resolve({ input: { text: 'hello' } }),
      outputMode: 'text',
    },
    async () => ({
      text: 'summary',
      _meta: {
        cost: options.cost,
        usage: {
          inputTokens: 1_000,
          outputTokens: 2_000,
          totalTokens: 3_000,
          inputTokenDetails: {},
          outputTokenDetails: {},
        },
      },
    }),
  )
}

describe('canonical cost, budget, and compaction observability', () => {
  afterEach(() => {
    resetHooks()
    resetObservabilityRuntime()
    vi.restoreAllMocks()
  })

    it('records cost entries and budget warnings as cost.record spans', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const tracker = withCostTracking({
      pricing: modelPricing({ 'gpt-4o': { input: 1, output: 1 } }),
      budget: { warn: 0.05, limit: 0.2 },
    })
    install(tracker.asPlugin())

    await observe.run({ name: 'costed generation', rootPrimitive: 'generation.call' }, async () => {
      await runWithExecutionContext({ traceId: 'trace-1', sessionId: 'session-1', flowId: 'flow-1', stepId: 'step-1' }, () =>
        generateOnce({ cost: 0.1 }),
      )
    })
    await observe.flush()

    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:start',
        primitive: 'cost.record',
        name: 'cost.record',
        attributes: expect.objectContaining({
          promptId: 'summarize',
          model: 'gpt-4o',
          provider: 'openai',
          source: 'actual',
          sessionId: 'session-1',
          flowId: 'flow-1',
          stepId: 'step-1',
        }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:event',
        name: 'cost.warn',
        attributes: expect.objectContaining({ threshold: 0.05, actual: 0.1 }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:end',
        status: 'ok',
        attributes: expect.objectContaining({ cost: 0.1, totalCost: 0.1, warning: true, limited: false }),
      }),
    )
  })

    it('records cost limit crossings before preserving the existing limit error', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const tracker = withCostTracking({ budget: { limit: 0.05 } })
    install(tracker.asPlugin())

    await expect(
      observe.run({ name: 'cost limit', rootPrimitive: 'generation.call' }, () => generateOnce({ cost: 0.1 })),
    ).rejects.toBeInstanceOf(CostLimitError)
    await observe.flush()

    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:event',
        name: 'cost.limit',
        attributes: expect.objectContaining({ threshold: 0.05, actual: 0.1 }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:end',
        status: 'error',
        attributes: expect.objectContaining({ limited: true, limit: 0.05, totalCost: 0.1 }),
      }),
    )
  })

    it('records budget checks as prompt.budget spans', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const budget = createBudgetManager({ limit: 100, warningThreshold: 0.5, criticalThreshold: 0.9 })
    budget.report('system', 30)
    budget.report('messages', 40)

    const state = budget.check()
    await observe.flush()

    expect(state.level).toBe('warning')
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:start',
        primitive: 'prompt.budget',
        name: 'budget.check',
        attributes: expect.objectContaining({ limit: 100, sourceCount: 2 }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:end',
        status: 'ok',
        attributes: expect.objectContaining({ used: 70, available: 30, pressure: 0.7, level: 'warning' }),
      }),
    )
  })

    it('records compaction summaries with before/after token metadata and bounded artifacts', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const generate = vi.fn(async () => ({ text: 'User discussed European capitals.' }))

    await observe.run({ name: 'compact conversation', rootPrimitive: 'compaction.run' }, async () => {
      await summarizeMessages({
        messages: [
          { role: 'user', content: 'What is the capital of France?' },
          { role: 'assistant', content: 'Paris.' },
        ],
        generate,
        model: 'summary-model',
        focus: ['decisions'],
      })
    })
    await observe.flush()

    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:start',
        primitive: 'compaction.run',
        name: 'compaction.summarize',
        attributes: expect.objectContaining({ messageCount: 2, model: 'summary-model', focus: ['decisions'] }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'compaction.report',
        attributes: expect.objectContaining({ primitive: 'compaction.run', compactionKind: 'summary' }),
        preview: expect.objectContaining({
          kind: 'compaction.report',
          strategy: 'summary',
          summaryPreview: 'User discussed European capitals.',
          beforeTokens: expect.any(Number),
          afterTokens: expect.any(Number),
        }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:end',
        status: 'ok',
        attributes: expect.objectContaining({ tokensBefore: expect.any(Number), tokensAfter: expect.any(Number) }),
      }),
    )
  })
})
