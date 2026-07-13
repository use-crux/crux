import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { prompt as makePrompt } from '../../src/prompt/prompt'
import { agent as makeAgent } from '../../src/agent/agent'
import { createParallel } from '../../src/agent/parallel'
import { createPipeline } from '../../src/agent/pipeline'
import { createConsensus } from '../../src/agent/consensus'
import { createSwarm } from '../../src/agent/swarm'
import { createFakeAgentExecutor } from '../../src/agent/fakes'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '../../src/observability'

const echoPrompt = makePrompt({
  id: 'echo',
  input: z.object({ content: z.string() }),
  output: z.object({ content: z.string() }),
  system: 'Echo',
})

const echoAgent = makeAgent({ id: 'echo-agent', prompt: echoPrompt })

function definitionIdFor(
  transport: ReturnType<typeof createInMemoryObservabilityTransport>,
  primitive: string,
): unknown {
  const spanStart = transport.records.find(
    (record) => record.type === 'span:start' && record.primitive === primitive,
  )
  return (spanStart as { attributes?: Record<string, unknown> } | undefined)
    ?.attributes?.definitionId
}

describe('composition runtime identity — authored id round-trips to the canonical definition id', () => {
  afterEach(() => {
    resetObservabilityRuntime()
  })

  it('parallel() stamps definitionId as composition.parallel:<id>', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const executor = createFakeAgentExecutor({
      agents: { 'echo-agent': { output: { content: 'ok' } } },
      fallback: { output: null },
    })

    const parallel = createParallel(executor)
    await parallel({
      id: 'review-parallel',
      context: { content: 'x' },
      agents: { echo: echoAgent },
    })
    await observe.flush()

    expect(definitionIdFor(transport, 'composition.parallel')).toBe(
      'composition.parallel:review-parallel',
    )
  })

  it('pipeline() stamps definitionId as composition.pipeline:<id>', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const executor = createFakeAgentExecutor({
      agents: { 'echo-agent': { output: { content: 'ok' } } },
      fallback: { output: null },
    })

    const pipeline = createPipeline(executor)
    await pipeline({
      id: 'review-pipeline',
      context: { content: 'x' },
      steps: [{ name: 'echo', agent: echoAgent }],
    })
    await observe.flush()

    expect(definitionIdFor(transport, 'composition.pipeline')).toBe(
      'composition.pipeline:review-pipeline',
    )
  })

  it('consensus() stamps definitionId as composition.consensus:<id>', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const executor = createFakeAgentExecutor({
      agents: { 'echo-agent': { output: { content: 'ok' } } },
      fallback: { output: null },
    })

    const consensus = createConsensus(executor)
    await consensus({
      id: 'review-consensus',
      agents: [echoAgent] as const,
      input: { content: 'x' },
      extract: (result) => result.output.content,
    })
    await observe.flush()

    expect(definitionIdFor(transport, 'composition.consensus')).toBe(
      'composition.consensus:review-consensus',
    )
  })

  it('swarm() stamps definitionId as composition.swarm:<id>', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const executor = createFakeAgentExecutor({
      agents: { 'echo-agent': { output: { content: 'ok' } } },
      fallback: { output: null },
    })

    const swarm = createSwarm(executor)
    await swarm({
      id: 'review-swarm',
      agents: { echo: echoAgent },
      startAgent: 'echo',
      input: { content: 'x' },
    })
    await observe.flush()

    expect(definitionIdFor(transport, 'composition.swarm')).toBe(
      'composition.swarm:review-swarm',
    )
  })
})
