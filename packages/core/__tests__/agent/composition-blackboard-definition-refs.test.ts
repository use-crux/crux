import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { prompt as makePrompt } from '../../src/prompt/prompt'
import { agent as makeAgent } from '../../src/agent/agent'
import { createParallel } from '../../src/agent/parallel'
import { createPipeline } from '../../src/agent/pipeline'
import { createConsensus } from '../../src/agent/consensus'
import { createSwarm } from '../../src/agent/swarm'
import { createFakeAgentExecutor } from '../../src/agent/fakes'
import { blackboard } from '../../src/agent/blackboard'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '../../src/observability'
import type { DefinitionRef } from '../../src/observability'

const echoPrompt = makePrompt({
  id: 'echo',
  input: z.object({ content: z.string() }),
  output: z.object({ content: z.string() }),
  system: 'Echo',
})
const echoAgent = makeAgent({ id: 'echo-agent', prompt: echoPrompt })

type Transport = ReturnType<typeof createInMemoryObservabilityTransport>

function startRecord(transport: Transport, primitive: string) {
  return transport.records.find(
    (record) => record.type === 'span:start' && record.primitive === primitive,
  ) as
    | {
        primitive: string
        attributes?: Record<string, unknown>
        definitionRefs?: DefinitionRef[]
      }
    | undefined
}

function startRecords(transport: Transport, primitive: string) {
  return transport.records.filter(
    (record) => record.type === 'span:start' && record.primitive === primitive,
  ) as Array<{
    primitive: string
    attributes?: Record<string, unknown>
    definitionRefs?: DefinitionRef[]
  }>
}

function makeExecutor() {
  return createFakeAgentExecutor({
    agents: { 'echo-agent': { output: { content: 'ok' } } },
    fallback: { output: null },
  })
}

const ABSOLUTE_PATH = /(^|")(\/[^"]*|[A-Za-z]:[\\/])/

describe('composition root spans emit an invoked-composition definition ref', () => {
  afterEach(() => {
    resetObservabilityRuntime()
  })

  it('parallel() emits composition.parallel:<id> distinct from the random compositionId', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const parallel = createParallel(makeExecutor())
    await parallel({
      id: 'review-parallel',
      context: { content: 'x' },
      agents: { echo: echoAgent },
    })
    await observe.flush()

    const start = startRecord(transport, 'composition.parallel')
    expect(start?.definitionRefs).toEqual([
      {
        id: 'composition.parallel:review-parallel',
        kind: 'composition.parallel',
        role: 'invoked-composition',
      },
    ])
    // Random per-execution id stays separate from the canonical authored id.
    const compositionId = start?.attributes?.compositionId as string
    expect(compositionId).toMatch(/^comp-/)
    expect(compositionId).not.toBe(start?.definitionRefs?.[0].id)
    expect(start?.definitionRefs?.[0].source).toBeUndefined()
  })

  it('pipeline() emits composition.pipeline:<id>', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const pipeline = createPipeline(makeExecutor())
    await pipeline({
      id: 'review-pipeline',
      context: { content: 'x' },
      steps: [{ name: 'echo', agent: echoAgent }],
    })
    await observe.flush()

    expect(startRecord(transport, 'composition.pipeline')?.definitionRefs).toEqual([
      {
        id: 'composition.pipeline:review-pipeline',
        kind: 'composition.pipeline',
        role: 'invoked-composition',
      },
    ])
  })

  it('consensus() emits composition.consensus:<id>', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const consensus = createConsensus(makeExecutor())
    await consensus({
      id: 'review-consensus',
      agents: [echoAgent] as const,
      input: { content: 'x' },
      extract: (result) => result.output.content,
    })
    await observe.flush()

    expect(startRecord(transport, 'composition.consensus')?.definitionRefs).toEqual([
      {
        id: 'composition.consensus:review-consensus',
        kind: 'composition.consensus',
        role: 'invoked-composition',
      },
    ])
  })

  it('swarm() emits composition.swarm:<id> and sanitizes the authored id', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const swarm = createSwarm(makeExecutor())
    await swarm({
      id: 'My Swarm!',
      agents: { echo: echoAgent },
      startAgent: 'echo',
      input: { content: 'x' },
    })
    await observe.flush()

    // safe_id parity: spaces collapse to `-`, trailing punctuation trimmed.
    expect(startRecord(transport, 'composition.swarm')?.definitionRefs?.[0].id).toBe(
      'composition.swarm:My-Swarm',
    )
  })
})

describe('blackboard read/write spans emit an invoked-blackboard definition ref', () => {
  afterEach(() => {
    resetObservabilityRuntime()
  })

  it('set() (write) and get() (read) both carry blackboard:<id> without dropping existing attributes', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const board = blackboard({
      id: 'research-board',
      schema: z.object({ status: z.string() }),
    })
    await board.set('status', 'ready')
    await board.get('status')
    await observe.flush()

    const expectedRef: DefinitionRef = {
      id: 'blackboard:research-board',
      kind: 'blackboard',
      role: 'invoked-blackboard',
    }

    const write = startRecord(transport, 'memory.write')
    expect(write?.definitionRefs).toEqual([expectedRef])
    // Existing evidence attributes must survive alongside the new ref.
    expect(write?.attributes?.sourceDefinitionId).toBe('blackboard:research-board')
    expect(write?.attributes?.memoryId).toBe('research-board')
    expect(write?.attributes?.blockId).toBe('research-board')

    const read = startRecord(transport, 'memory.read')
    expect(read?.definitionRefs).toEqual([expectedRef])
  })

  it('every board span carries the ref and never leaks an absolute source path', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const board = blackboard({
      id: 'coord',
      schema: z.object({ a: z.string(), b: z.string() }),
    })
    await board.set('a', '1')
    await board.patch({ b: '2' })
    await board.getAll()
    await board.clear()
    await observe.flush()

    const boardSpans = [
      ...startRecords(transport, 'memory.read'),
      ...startRecords(transport, 'memory.write'),
    ]
    expect(boardSpans.length).toBeGreaterThanOrEqual(4)
    for (const span of boardSpans) {
      expect(span.definitionRefs?.[0]?.id).toBe('blackboard:coord')
      expect(span.definitionRefs?.[0]?.source).toBeUndefined()
    }

    // No definition ref anywhere in the batch carries an absolute host path.
    const refs = transport.records.flatMap(
      (record) =>
        (record as { definitionRefs?: DefinitionRef[] }).definitionRefs ?? [],
    )
    for (const ref of refs) {
      expect(JSON.stringify(ref)).not.toMatch(ABSOLUTE_PATH)
    }
  })
})
