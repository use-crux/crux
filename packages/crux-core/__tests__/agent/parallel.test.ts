import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { prompt as makePrompt } from '../../define'
import { agent as makeAgent } from '../../agent/agent'
import { createParallel } from '../../agent/parallel'
import type { AgentExecutor } from '../../agent/executor'
import { getExecutionContext } from '../../execution-context'

const promptA = makePrompt({
  id: 'prompt-a',
  input: z.object({ content: z.string() }),
  output: z.object({ score: z.number() }),
  system: 'Agent A',
})

const promptB = makePrompt({
  id: 'prompt-b',
  input: z.object({ content: z.string() }),
  output: z.object({ tags: z.array(z.string()) }),
  system: 'Agent B',
})

const agentA = makeAgent({ id: 'agent-a', prompt: promptA })
const agentB = makeAgent({ id: 'agent-b', prompt: promptB })

function createMockExecutor(outputs: Record<string, unknown>): AgentExecutor {
  return async (agent, options) => ({
    agentId: agent.id,
    output: outputs[agent.id] ?? null,
    durationMs: 10,
  })
}

describe('parallel: named results with seed context', () => {
  it('returns named results accessible by agent key', async () => {
    const executor = createMockExecutor({
      'agent-a': { score: 0.9 },
      'agent-b': { tags: ['ai', 'safety'] },
    })
    const parallel = createParallel(executor)

    const result = await parallel({
      context: { userId: 'u1' },
      agents: { reviewer: agentA, tagger: agentB },
    })

    expect(result.results.reviewer.output).toEqual({ score: 0.9 })
    expect(result.results.tagger.output).toEqual({ tags: ['ai', 'safety'] })
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('passes seed context to all agents as input', async () => {
    const receivedInputs: Record<string, unknown> = {}
    const executor: AgentExecutor = async (agent, options) => {
      receivedInputs[agent.id] = options.input
      return { agentId: agent.id, output: {}, durationMs: 1 }
    }
    const parallel = createParallel(executor)

    await parallel({
      context: { content: 'test article' },
      agents: { a: agentA, b: agentB },
    })

    expect(receivedInputs['agent-a']).toEqual({ content: 'test article' })
    expect(receivedInputs['agent-b']).toEqual({ content: 'test article' })
  })

  it('runs agents concurrently', async () => {
    const callOrder: string[] = []
    const executor: AgentExecutor = async (agent) => {
      callOrder.push(`start:${agent.id}`)
      await new Promise((r) => setTimeout(r, 50))
      callOrder.push(`end:${agent.id}`)
      return { agentId: agent.id, output: {}, durationMs: 50 }
    }
    const parallel = createParallel(executor)

    const start = Date.now()
    await parallel({
      context: {},
      agents: { a: agentA, b: agentB },
    })
    const elapsed = Date.now() - start

    // Both should start before either finishes
    expect(callOrder[0]).toBe('start:agent-a')
    expect(callOrder[1]).toBe('start:agent-b')
    expect(elapsed).toBeLessThan(90)
  })

  it('returns empty results for empty agents', async () => {
    const executor = createMockExecutor({})
    const parallel = createParallel(executor)

    const result = await parallel({
      context: {},
      agents: {},
    })

    expect(result.results).toEqual({})
  })

  it('fail-fast: rejects when any agent fails', async () => {
    const executor: AgentExecutor = async (agent) => {
      if (agent.id === 'agent-b') throw new Error('agent-b failed')
      return { agentId: agent.id, output: {}, durationMs: 0 }
    }
    const parallel = createParallel(executor)

    await expect(parallel({ context: {}, agents: { a: agentA, b: agentB } })).rejects.toThrow('agent-b failed')
  })

  it('continue mode: returns settled results with errors', async () => {
    const executor: AgentExecutor = async (agent) => {
      if (agent.id === 'agent-b') throw new Error('agent-b failed')
      return { agentId: agent.id, output: { ok: true }, durationMs: 0 }
    }
    const parallel = createParallel(executor)

    const result = await parallel({
      context: {},
      agents: { a: agentA, b: agentB },
      onError: 'continue',
    })

    expect(result.settled!.a.status).toBe('success')
    expect(result.settled!.b.status).toBe('error')
    expect((result.settled!.b as { error: Error }).error.message).toBe('agent-b failed')
  })

  it('plain fn agents work alongside Agent instances', async () => {
    const executor = createMockExecutor({ 'agent-a': { score: 0.9 } })
    const parallel = createParallel(executor)

    const result = await parallel({
      context: { content: 'test' },
      agents: {
        reviewer: agentA,
        custom: async (input: unknown) => ({ custom: true }),
      },
    })

    expect(result.results.reviewer.output).toEqual({ score: 0.9 })
    expect(result.results.custom.output).toEqual({ custom: true })
  })

  it('sets trace context with agent key as step label', async () => {
    const capturedContexts: Record<string, unknown> = {}
    const executor: AgentExecutor = async (agent) => {
      capturedContexts[agent.id] = getExecutionContext()
      return { agentId: agent.id, output: 'ok', durationMs: 10 }
    }
    const parallel = createParallel(executor)

    await parallel({
      context: {},
      agents: { reviewer: agentA, checker: agentB },
    })

    expect((capturedContexts['agent-a'] as { stepLabel: string })?.stepLabel).toBe('reviewer')
    expect((capturedContexts['agent-b'] as { stepLabel: string })?.stepLabel).toBe('checker')
  })

  it('emits composition events', async () => {
    const events: Array<{ type: string }> = []
    const { setRuntime, resetRuntime } = await import('../../runtime')
    setRuntime({
      instrumentationHooks: {
        onCompositionStart: () => events.push({ type: 'start' }),
        onCompositionAgent: () => events.push({ type: 'agent' }),
        onCompositionEnd: () => events.push({ type: 'end' }),
      },
    })

    try {
      const executor = createMockExecutor({ 'agent-a': {}, 'agent-b': {} })
      const parallel = createParallel(executor)

      await parallel({
        context: {},
        agents: { a: agentA, b: agentB },
      })

      expect(events.filter((e) => e.type === 'start')).toHaveLength(1)
      expect(events.filter((e) => e.type === 'agent')).toHaveLength(2)
      expect(events.filter((e) => e.type === 'end')).toHaveLength(1)
    } finally {
      resetRuntime()
    }
  })
})