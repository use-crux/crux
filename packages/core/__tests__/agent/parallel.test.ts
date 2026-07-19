import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { prompt as makePrompt } from '../../src/prompt/prompt'
import { agent as makeAgent } from '../../src/agent/agent'
import { createParallel } from '../../src/agent/parallel'
import { createFakeAgentExecutor } from '../../src/agent/fakes'
// One concurrency-timing test below needs a real delaying executor the shared
// fake doesn't model — it keeps a bespoke inline executor (see SCRATCHPAD).
import type { AgentExecutor } from '../../src/agent/executor'
import { registerParallelResultCorrelationCases } from './parallel-result-correlation.cases'

registerParallelResultCorrelationCases()

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

function createMockExecutor(outputs: Record<string, unknown>) {
  return createFakeAgentExecutor({
    agents: Object.fromEntries(Object.entries(outputs).map(([id, output]) => [id, { output }])),
    fallback: { output: null },
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
      id: 'parallel.test-parallel-1',
      context: { userId: 'u1' },
      agents: { reviewer: agentA, tagger: agentB },
    })

    expect(result.results.reviewer.output).toEqual({ score: 0.9 })
    expect(result.results.tagger.output).toEqual({ tags: ['ai', 'safety'] })
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('passes seed context to all agents as input', async () => {
    const executor = createMockExecutor({})
    const parallel = createParallel(executor)

    await parallel({
      id: 'parallel.test-parallel-2',
      context: { content: 'test article' },
      agents: { a: agentA, b: agentB },
    })

    const inputFor = (id: string) => executor.calls.find((c) => c.agent.id === id)?.options.input
    expect(inputFor('agent-a')).toEqual({ content: 'test article' })
    expect(inputFor('agent-b')).toEqual({ content: 'test article' })
  })

  it('runs agents concurrently', async () => {
    const callOrder: string[] = []
    let started = 0
    let releaseBothStarted: () => void = () => {}
    const bothStarted = new Promise<void>((resolve) => {
      releaseBothStarted = resolve
    })
    const executor: AgentExecutor = async (agent) => {
      callOrder.push(`start:${agent.id}`)
      started += 1
      if (started === 2) releaseBothStarted()
      await bothStarted
      callOrder.push(`end:${agent.id}`)
      return { agentId: agent.id, output: {}, durationMs: 50 }
    }
    const parallel = createParallel(executor)

    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        parallel({
          id: 'parallel.test-parallel-3',
          context: {},
          agents: { a: agentA, b: agentB },
        }),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error(`agents did not start concurrently: ${callOrder.join(',')}`)),
            500,
          )
        }),
      ])
    } finally {
      if (timeout !== undefined) clearTimeout(timeout)
    }

    // Both should start before either finishes
    expect(callOrder[0]).toBe('start:agent-a')
    expect(callOrder[1]).toBe('start:agent-b')
    expect(callOrder).toContain('end:agent-a')
    expect(callOrder).toContain('end:agent-b')
  })

  it('returns empty results for empty agents', async () => {
    const executor = createMockExecutor({})
    const parallel = createParallel(executor)

    const result = await parallel({
      id: 'parallel.test-parallel-4',
      context: {},
      agents: {},
    })

    expect(result.results).toEqual({})
  })

  it('fail-fast: rejects when any agent fails', async () => {
    const executor = createFakeAgentExecutor({
      agents: { 'agent-a': { output: {} }, 'agent-b': { throws: 'agent-b failed' } },
    })
    const parallel = createParallel(executor)

    await expect(parallel({ id: 'parallel-test-fail-fast', context: {}, agents: { a: agentA, b: agentB } })).rejects.toThrow('agent-b failed')
  })

  it('continue mode: returns settled results with errors', async () => {
    const executor = createFakeAgentExecutor({
      agents: { 'agent-a': { output: { ok: true } }, 'agent-b': { throws: 'agent-b failed' } },
    })
    const parallel = createParallel(executor)

    const result = await parallel({
      id: 'parallel.test-parallel-5',
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
      id: 'parallel.test-parallel-6',
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
    const executor = createMockExecutor({})
    const parallel = createParallel(executor)

    await parallel({
      id: 'parallel.test-parallel-7',
      context: {},
      agents: { reviewer: agentA, checker: agentB },
    })

    const ctxFor = (id: string) => executor.calls.find((c) => c.agent.id === id)?.executionContext
    expect(ctxFor('agent-a')?.stepLabel).toBe('reviewer')
    expect(ctxFor('agent-b')?.stepLabel).toBe('checker')
  })
})
