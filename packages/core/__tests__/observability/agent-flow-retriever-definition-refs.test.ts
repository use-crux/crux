import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { prompt as makePrompt } from '../../src/prompt/prompt'
import { agent as makeAgent } from '../../src/agent/agent'
import { createParallel } from '../../src/agent/parallel'
import { createPipeline } from '../../src/agent/pipeline'
import { createFakeAgentExecutor } from '../../src/agent/fakes'
import { flow } from '../../src/flow'
import { retriever as makeRetriever } from '../../src/retrieval'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '../../src/observability'
import type { DefinitionRef } from '../../src/observability'

type Transport = ReturnType<typeof createInMemoryObservabilityTransport>

function startRecords(transport: Transport, primitive: string) {
  return transport.records.filter(
    (record) => record.type === 'span:start' && record.primitive === primitive,
  ) as Array<{
    primitive: string
    name?: string
    attributes?: Record<string, unknown>
    definitionRefs?: DefinitionRef[]
  }>
}

const ABSOLUTE_PATH = /(^|")(\/[^"]*|[A-Za-z]:[\\/])/

const echoPrompt = makePrompt({
  id: 'echo',
  input: z.object({ content: z.string() }),
  output: z.object({ content: z.string() }),
  system: 'Echo',
})
const echoAgent = makeAgent({ id: 'echo-agent', prompt: echoPrompt })

function makeExecutor() {
  return createFakeAgentExecutor({
    agents: { 'echo-agent': { output: { content: 'ok' } } },
    fallback: { output: { content: 'fn' } },
  })
}

describe('agent.run spans emit an invoked-agent definition ref', () => {
  afterEach(() => {
    resetObservabilityRuntime()
  })

  it('a nested agent step emits agent:<compiled-id>, distinct from the step label', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const pipeline = createPipeline(makeExecutor())
    await pipeline({
      id: 'p',
      context: { content: 'x' },
      // Step label intentionally differs from the compiled agent id to prove
      // the ref targets the authored agent identity, not the step name.
      steps: [{ name: 'reviewer', agent: echoAgent }],
    })
    await observe.flush()

    const agentSpans = startRecords(transport, 'agent.run')
    expect(agentSpans.length).toBeGreaterThanOrEqual(1)
    const withAgent = agentSpans.find((s) => s.attributes?.agentId === 'echo-agent')
    expect(withAgent?.definitionRefs).toEqual([
      { id: 'agent:echo-agent', kind: 'agent', role: 'invoked-agent' },
    ])
    // The canonical id targets the compiled agent, not the step label.
    expect(withAgent?.definitionRefs?.[0].id).not.toContain('reviewer')
    expect(withAgent?.definitionRefs?.[0].source).toBeUndefined()
  })

  it('a plain-function agent (anonymous handle) emits no agent ref', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const parallel = createParallel(makeExecutor())
    await parallel({
      id: 'p',
      context: { content: 'x' },
      // A plain function has no compiled agent identity; its agent.run span
      // must carry no invoked-agent ref rather than guess one from the label.
      agents: { shape: async () => ({ content: 'shaped' }) },
    })
    await observe.flush()

    const fnSpan = startRecords(transport, 'agent.run').find(
      (s) => s.attributes?.agentId === 'shape',
    )
    expect(fnSpan).toBeDefined()
    expect(fnSpan?.definitionRefs).toEqual([
      {
        id: 'composition.parallel:p:branch:shape',
        kind: 'composition.parallel.branch',
        role: 'invoked-composition-branch',
      },
    ])
  })
})

describe('flow.run spans emit an invoked-flow definition ref', () => {
  afterEach(() => {
    resetObservabilityRuntime()
  })

  it('flow() emits flow:<safeId(name)> on its flow.run span', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const research = flow('My Flow!', async (scope) => scope.step('Load docs!', async () => 'done'))
    await research.run()
    await observe.flush()

    const flowSpans = startRecords(transport, 'flow.run')
    expect(flowSpans.length).toBeGreaterThanOrEqual(1)
    // safe_id parity: spaces collapse to `-`, trailing punctuation trimmed.
    expect(flowSpans[0].definitionRefs).toEqual([
      { id: 'flow:My-Flow', kind: 'flow', role: 'invoked-flow' },
    ])
    expect(startRecords(transport, 'flow.step')[0]?.definitionRefs).toEqual([
      { id: 'flow.step:My-Flow:Load-docs', kind: 'flow.step', role: 'invoked-flow-step' },
    ])
  })
})

describe('retrieval.query spans emit an invoked-retriever definition ref', () => {
  afterEach(() => {
    resetObservabilityRuntime()
  })

  it('retriever() emits rag.retriever:<safeId(id)> on its retrieval.query span', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const kb = makeRetriever({
      id: 'kb-docs',
      namespace: 'docs',
      retrieve: async () => [],
    })
    await kb.retrieve('hello')
    await observe.flush()

    const querySpans = startRecords(transport, 'retrieval.query')
    expect(querySpans.length).toBeGreaterThanOrEqual(1)
    expect(querySpans[0].definitionRefs).toEqual([
      { id: 'rag.retriever:kb-docs', kind: 'rag.retriever', role: 'invoked-retriever' },
    ])

    const refs = transport.records.flatMap(
      (record) => (record as { definitionRefs?: DefinitionRef[] }).definitionRefs ?? [],
    )
    for (const ref of refs) {
      expect(JSON.stringify(ref)).not.toMatch(ABSOLUTE_PATH)
    }
  })
})
