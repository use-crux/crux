import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { prompt } from '../../prompt/prompt'
import { applyPlugins } from '../../runtime/plugin'
import { getHooks, resetHooks, setHooks } from '../../runtime/runtime'
import { orchestrateGenerate } from '../../generation/orchestrate'
import { runWithExecutionContext } from '../../runtime/execution-context'
import { CostLimitError, modelPricing, withCostTracking } from '../../cost'

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

async function generateOnce(options: {
  cost?: number
  inputTokens?: number
  outputTokens?: number
  model?: string
  provider?: string
}) {
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
          inputTokens: options.inputTokens ?? 1_000,
          outputTokens: options.outputTokens ?? 2_000,
          totalTokens: (options.inputTokens ?? 1_000) + (options.outputTokens ?? 2_000),
          inputTokenDetails: {},
          outputTokenDetails: {},
        },
      },
    }),
  )
}

describe('withCostTracking', () => {
  afterEach(() => {
    resetHooks()
    vi.restoreAllMocks()
  })

    it('uses provider-reported cost when present', async () => {
    const tracker = withCostTracking({
      pricing: modelPricing({
        'gpt-4o': { input: 2.5, output: 10 },
      }),
    })
    install(tracker.asPlugin())

    await generateOnce({ cost: 0.42 })

    const report = tracker.getReport()
    expect(report.total.cost).toBe(0.42)
    expect(report.total.inputTokens).toBe(1_000)
    expect(report.total.outputTokens).toBe(2_000)
    expect(report.entries[0]?.source).toBe('actual')
    expect(report.byPrompt.summarize?.cost).toBe(0.42)
    expect(report.byModel['gpt-4o']?.cost).toBe(0.42)
  })

    it('estimates cost from token usage and pricing when provider cost is absent', async () => {
    const tracker = withCostTracking({
      pricing: modelPricing({
        'gpt-4o': { input: 2.5, output: 10 },
      }),
    })
    install(tracker.asPlugin())

    await generateOnce({ inputTokens: 1_000, outputTokens: 2_000 })

    const report = tracker.getReport()
    expect(report.total.cost).toBeCloseTo(0.0225)
    expect(report.entries[0]?.source).toBe('estimated')
  })

    it('attributes cost to active trace context dimensions', async () => {
    const tracker = withCostTracking({
      pricing: modelPricing({
        'gpt-4o': { input: 1, output: 1 },
      }),
    })
    install(tracker.asPlugin())

    await runWithExecutionContext(
      {
        traceId: 'trace-1',
        sessionId: 'session-1',
        flowId: 'flow-1',
        stepId: 'step-1',
        stepLabel: 'Draft',
      },
      () => generateOnce({ cost: 0.1 }),
    )

    const report = tracker.getReport()
    expect(report.bySession['session-1']?.cost).toBe(0.1)
    expect(report.byFlow['flow-1']?.cost).toBe(0.1)
    expect(report.byStep['step-1']?.cost).toBe(0.1)
    expect(report.entries[0]).toMatchObject({
      traceId: 'trace-1',
      sessionId: 'session-1',
      flowId: 'flow-1',
      stepId: 'step-1',
      stepLabel: 'Draft',
    })
  })

    it('resets all entries or only one session', async () => {
    const tracker = withCostTracking()
    install(tracker.asPlugin())

    await runWithExecutionContext({ sessionId: 'a' }, () => generateOnce({ cost: 0.1 }))
    await runWithExecutionContext({ sessionId: 'b' }, () => generateOnce({ cost: 0.2 }))

    tracker.reset('a')
    expect(tracker.getReport().total.cost).toBe(0.2)

    tracker.reset()
    expect(tracker.getReport().total.cost).toBe(0)
  })
})
