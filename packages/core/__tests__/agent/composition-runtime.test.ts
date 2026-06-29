import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { agent as makeAgent } from '../../agent/agent'
import { createCompositionRuntime } from '../../agent/composition-runtime'
import type { AgentExecutor } from '../../agent/executor'
import { prompt as makePrompt } from '../../prompt/prompt'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '../../observability'

afterEach(() => {
  resetObservabilityRuntime()
})

const reviewPrompt = makePrompt({
  id: 'review',
  input: z.object({ content: z.string() }),
  output: z.object({ verdict: z.string() }),
  system: 'Review',
})

const reviewer = makeAgent({ id: 'reviewer', prompt: reviewPrompt })

describe('composition runtime', () => {
  it('owns the shared lifecycle around agent execution', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const executorCalls: Array<{
      input: unknown
      stepLabel?: string
      sessionId?: string
    }> = []
    let attempts = 0
    const executor: AgentExecutor = async (_agent, options) => {
      const { getExecutionContext } =
        await import('../../runtime/execution-context')
      executorCalls.push({
        input: options.input,
        stepLabel: getExecutionContext()?.stepLabel,
        sessionId: getExecutionContext()?.sessionId,
      })
      attempts += 1
      if (attempts === 1) throw new Error('temporary failure')
      return { agentId: 'reviewer', output: { verdict: 'ok' }, durationMs: 3 }
    }

    const runtime = createCompositionRuntime({
      kind: 'parallel',
      agentIds: ['reviewer'],
      sessionId: 'sess-runtime',
      attributes: { onError: 'fail-fast' },
    })

    const result = await runtime.run(async (scope) => {
      const agentResult = await scope.executeAgent({
        agent: reviewer,
        executor,
        label: 'review',
        index: 0,
        input: { content: 'hello' },
        retry: { retry: { attempts: 2, delay: 0 } },
      })

      scope.report({
        preview: {
          kind: 'composition.report',
          compositionType: 'parallel',
          compositionId: runtime.compositionId,
          status: 'success',
          branches: [{ id: 'review', status: 'success' }],
        },
        attributes: {
          primitive: 'composition.parallel',
          compositionId: runtime.compositionId,
          status: 'success',
          branchCount: 1,
        },
      })

      return agentResult
    })
    await observe.flush()

    expect(result.output).toEqual({ verdict: 'ok' })
    expect(executorCalls).toEqual([
      {
        input: { content: 'hello' },
        stepLabel: 'review',
        sessionId: 'sess-runtime',
      },
      {
        input: { content: 'hello' },
        stepLabel: 'review',
        sessionId: 'sess-runtime',
      },
    ])
    const spanStarts = transport.records.filter(
      (record) => record.type === 'span:start',
    )
    const compositionSpan = spanStarts.find(
      (record) => record.primitive === 'composition.parallel',
    )
    expect(compositionSpan).toMatchObject({
      type: 'span:start',
      name: 'parallel',
      family: 'composition',
      primitive: 'composition.parallel',
      attributes: expect.objectContaining({
        compositionId: runtime.compositionId,
        agentIds: ['reviewer'],
        onError: 'fail-fast',
      }),
    })
    expect(
      spanStarts.find((record) => record.primitive === 'agent.run'),
    ).toMatchObject({
      type: 'span:start',
      name: 'review',
      family: 'agent',
      primitive: 'agent.run',
      parentSpanId: compositionSpan?.spanId,
      attributes: expect.objectContaining({
        compositionId: runtime.compositionId,
        agentId: 'reviewer',
        stepLabel: 'review',
        index: 0,
      }),
    })
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'composition.report',
        preview: expect.objectContaining({
          compositionType: 'parallel',
          compositionId: runtime.compositionId,
          status: 'success',
        }),
      }),
    )
  })
})
