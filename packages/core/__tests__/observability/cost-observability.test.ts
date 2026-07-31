import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { CostLimitError, modelPricing, withCostTracking } from '../../src/cost'
import { prompt } from '../../src/prompt/prompt'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '../../src/observability'
import { orchestrateGenerate } from '../../src/generation/orchestrate'
import { applyPlugins } from '../../src/runtime/plugin'
import { getHooks, resetHooks, setHooks } from '../../src/runtime/runtime'
import { runWithExecutionContext } from '../../src/runtime/execution-context'

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

describe('canonical cost observability', () => {
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

})
