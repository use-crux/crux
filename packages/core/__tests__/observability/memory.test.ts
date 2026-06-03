import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '../../observability'
import { blackboard } from '../../agent/blackboard'
import { facts, memory, recentMessages, workingState } from '../../memory'
import { inMemoryCruxStore } from '../../store/memory'

describe('canonical memory observability', () => {
  afterEach(() => {
    resetObservabilityRuntime()
  })

  it('records standalone memory writes and reads with snapshot artifacts and relation edges', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const store = inMemoryCruxStore()
    const state = workingState({
      id: 'state',
      schema: z.object({ step: z.number(), goal: z.string() }),
    })

    await state.set({ step: 1, goal: 'draft' }, { store, namespace: 'thread:1', memoryId: 'planner' })
    await state.get({ store, namespace: 'thread:1', memoryId: 'planner' })
    await observe.flush()

    const spanStarts = transport.records.filter((record) => record.type === 'span:start')
    expect(spanStarts.map((record) => record.primitive)).toEqual(['memory.write', 'memory.read'])
    expect(spanStarts).toContainEqual(
      expect.objectContaining({
        primitive: 'memory.write',
        name: 'state.set',
        attributes: expect.objectContaining({ memoryId: 'planner', blockId: 'state', blockKind: 'working' }),
      }),
    )
    expect(spanStarts).toContainEqual(
      expect.objectContaining({
        primitive: 'memory.read',
        name: 'state.get',
        attributes: expect.objectContaining({ memoryId: 'planner', blockId: 'state', blockKind: 'working' }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'memory.snapshot',
        preview: expect.objectContaining({
          kind: 'memory.snapshot',
          memoryType: 'block',
          blockKind: 'working',
          operation: 'set',
        }),
      }),
    )
    expect(transport.records).toContainEqual(expect.objectContaining({ type: 'edge', edgeType: 'memory.write' }))
    expect(transport.records).toContainEqual(expect.objectContaining({ type: 'edge', edgeType: 'memory.read' }))
  })

  it('records blackboard reads and writes as memory activity', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const board = blackboard({
      id: 'research',
      schema: z.object({ status: z.string(), notes: z.array(z.string()).optional() }),
    })

    await board.set('status', 'planning')
    await board.patch({ notes: ['source found'] })
    await board.getAll()
    await observe.flush()

    const spanStarts = transport.records.filter((record) => record.type === 'span:start')
    expect(spanStarts.map((record) => record.primitive)).toEqual(['memory.write', 'memory.write', 'memory.read'])
    expect(spanStarts).toContainEqual(
      expect.objectContaining({
        name: 'research.set',
        attributes: expect.objectContaining({
          memoryId: 'research',
          memoryType: 'blackboard',
          blockKind: 'blackboard',
          operation: 'set',
        }),
      }),
    )
    expect(spanStarts).toContainEqual(
      expect.objectContaining({
        name: 'research.getAll',
        attributes: expect.objectContaining({ operation: 'getAll' }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'memory.snapshot',
        attributes: expect.objectContaining({ memoryType: 'blackboard' }),
        preview: expect.objectContaining({
          kind: 'memory.snapshot',
          memoryType: 'blackboard',
          blockKind: 'blackboard',
        }),
      }),
    )
    expect(transport.records).toContainEqual(expect.objectContaining({ type: 'edge', edgeType: 'memory.write' }))
    expect(transport.records).toContainEqual(expect.objectContaining({ type: 'edge', edgeType: 'memory.read' }))
  })

  it('records memory context hydration as child memory.read spans', async () => {
    const store = inMemoryCruxStore()
    const recent = recentMessages({ id: 'recent' })
    await recent.addTurn(
      { messages: [{ role: 'user', content: 'Remember concise answers.' }] },
      { store, namespace: 'thread:1', memoryId: 'conversation' },
    )
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const mem = memory({
      id: 'conversation',
      store,
      namespace: 'thread:1',
      blocks: [recent],
    })

    await observe.run({ name: 'hydrate memory', rootPrimitive: 'prompt.resolve' }, async () => {
      await observe.span({ name: 'memory context', family: 'context', primitive: 'context.resolve' }, async () => {
        await mem.asContext().systemFn({})
      })
    })
    await observe.flush()

    const spanStarts = transport.records.filter((record) => record.type === 'span:start')
    const readSpan = spanStarts.find((record) => record.primitive === 'memory.read' && record.name === 'recent.list')
    expect(readSpan).toMatchObject({
      family: 'memory',
      primitive: 'memory.read',
      attributes: expect.objectContaining({ memoryId: 'conversation', blockId: 'recent', operation: 'list' }),
    })
    expect(readSpan?.parentSpanId).toBeTruthy()
  })

  it('records proposals and approvals as memory writes', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const store = inMemoryCruxStore()
    const factBlock = facts({
      id: 'facts',
      extract: async () => [{ content: 'User prefers concise answers', confidence: 0.9 }],
    })
    const mem = memory({
      id: 'profile',
      store,
      namespace: 'user:1',
      blocks: [factBlock],
      processing: { mode: 'inline' },
    })

    await mem.captureTurn({
      messages: [{ role: 'user', content: 'Please be concise' }],
      source: { promptId: 'p1' },
    })
    const proposals = await mem.proposals.list({ namespace: 'user:1' })
    await mem.proposals.approve(proposals[0].id)
    await observe.flush()

    const spanStarts = transport.records.filter((record) => record.type === 'span:start')
    expect(spanStarts).toContainEqual(
      expect.objectContaining({
        primitive: 'memory.write',
        name: 'facts.propose',
        attributes: expect.objectContaining({ writeMode: 'propose', proposalStatus: 'pending' }),
      }),
    )
    expect(spanStarts).toContainEqual(
      expect.objectContaining({
        primitive: 'memory.write',
        name: 'facts.approveProposal',
        attributes: expect.objectContaining({ proposalStatus: 'approved' }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'memory.snapshot',
        preview: expect.objectContaining({
          kind: 'memory.snapshot',
          memoryType: 'block',
          blockKind: 'facts',
          mode: 'propose',
          status: 'pending',
        }),
      }),
    )
  })
})
