import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '../../src/observability'
import { blackboard } from '../../src/agent/blackboard'
import { facts, memory, recentMessages, workingState } from '../../src/memory'
import { inMemoryRecordStore, inMemoryVectorStore } from '../../src/storage'

describe('canonical memory observability', () => {
  afterEach(() => {
    resetObservabilityRuntime()
  })

    it('records standalone memory writes and reads with snapshot artifacts and relation edges', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const store = inMemoryRecordStore()
    const state = workingState({
      id: 'state',
      schema: z.object({ step: z.number(), goal: z.string() }),
    })

    await state.set({ step: 1, goal: 'draft' }, { records: store, namespace: 'thread:1', memoryId: 'planner' })
    await state.get({ records: store, namespace: 'thread:1', memoryId: 'planner' })
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

    it('records working-state writes with before and after diff artifacts', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const store = inMemoryRecordStore()
    const state = workingState({
      id: 'state',
      schema: z.object({ intent: z.string(), plan: z.string().optional() }),
    })

    await state.set({ intent: 'refund' }, { records: store, namespace: 'thread:1', memoryId: 'planner' })
    await state.set({ intent: 'refund', plan: 'annual' }, { records: store, namespace: 'thread:1', memoryId: 'planner' })
    await observe.flush()

    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'memory.diff',
        preview: expect.objectContaining({
          kind: 'memory.diff',
          memoryType: 'block',
          blockKind: 'working',
          operation: 'set',
          before: { intent: 'refund' },
          after: { intent: 'refund', plan: 'annual' },
        }),
      }),
    )
    expect(transport.records).toContainEqual(expect.objectContaining({ type: 'edge', edgeType: 'memory.write' }))
  })

    it('records recalled memory blocks with key, preview, score, and query', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const store = inMemoryRecordStore()
    const vectors = inMemoryVectorStore()
    const factBlock = facts({
      id: 'facts',
      embed: async (text) => (text.includes('refund') ? [1, 0] : [0, 1]),
      write: { mode: 'auto' },
    })

    await factBlock.add(
      { content: 'User wants help with a refund.', confidence: 0.8 },
      { records: store, vectors, namespace: 'user:1', memoryId: 'profile' },
    )
    await factBlock.find('refund policy', { records: store, vectors, namespace: 'user:1', memoryId: 'profile', limit: 3 })
    await observe.flush()

    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'memory.recall',
        preview: expect.objectContaining({
          kind: 'memory.recall',
          memoryType: 'block',
          blockKind: 'facts',
          operation: 'find',
          query: 'refund policy',
          returned: 1,
          blocks: [
            expect.objectContaining({
              blockKind: 'facts',
              key: expect.any(String),
              preview: 'User wants help with a refund.',
              score: expect.any(Number),
            }),
          ],
        }),
      }),
    )
    expect(transport.records).toContainEqual(expect.objectContaining({ type: 'edge', edgeType: 'memory.read' }))
  })

    it('does not emit recalled-block artifacts for empty memory reads', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const store = inMemoryRecordStore()
    const factBlock = facts({
      id: 'facts',
      embed: async () => [1, 0],
      write: { mode: 'auto' },
    })

    await factBlock.find('refund policy', { records: store, namespace: 'user:1', memoryId: 'profile', limit: 3 })
    await observe.flush()

    expect(transport.records).toContainEqual(expect.objectContaining({ type: 'span:start', primitive: 'memory.read' }))
    expect(transport.records).not.toContainEqual(expect.objectContaining({ type: 'artifact', kind: 'memory.recall' }))
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
    const store = inMemoryRecordStore()
    const recent = recentMessages({ id: 'recent' })
    await recent.addTurn(
      { messages: [{ role: 'user', content: 'Remember concise answers.' }] },
      { records: store, namespace: 'thread:1', memoryId: 'conversation' },
    )
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const mem = memory({
      id: 'conversation',
      records: store,
      namespace: 'thread:1',
      blocks: [recent],
    })

    await observe.run({ name: 'hydrate memory', rootPrimitive: 'prompt.resolve' }, async () => {
      await observe.span({ name: 'memory context', primitive: 'context.resolve' }, async () => {
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
    const store = inMemoryRecordStore()
    const factBlock = facts({
      id: 'facts',
      extract: async () => [{ content: 'User prefers concise answers', confidence: 0.9 }],
    })
    const mem = memory({
      id: 'profile',
      records: store,
      namespace: 'user:1',
      blocks: [factBlock],
      capture: { mode: 'inline' },
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
        attributes: expect.objectContaining({
          writeMode: 'propose',
          proposalStatus: 'pending',
          proposalSourcePromptId: 'p1',
        }),
      }),
    )
    expect(spanStarts).toContainEqual(
      expect.objectContaining({
        primitive: 'memory.write',
        name: 'facts.approveProposal',
        attributes: expect.objectContaining({ proposalStatus: 'approved', proposalSourcePromptId: 'p1' }),
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

  it('records memory policy decisions with redacted evidence', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const store = inMemoryRecordStore()
    const factBlock = facts({
      id: 'facts',
      extract: async () => [
        {
          content: 'Customer private@example.com uses sk-live-secret',
          confidence: 0.9,
        },
      ],
      write: { mode: 'auto' },
      policy: {
        redact: async (candidate) => ({
          ...candidate,
          content: candidate.content.replace('Customer', 'User'),
        }),
      },
    })
    const mem = memory({
      id: 'profile',
      records: store,
      namespace: 'user:1',
      blocks: [factBlock],
      capture: { mode: 'inline' },
    })

    await mem.captureTurn({
      messages: [{ role: 'user', content: 'Remember this preference' }],
    })
    await observe.flush()

    const policySpan = transport.records.find(
      (record) => record.type === 'span:start' && record.primitive === 'memory.write' && record.name === 'facts.policy.redact',
    )
    expect(policySpan).toMatchObject({
      attributes: expect.objectContaining({
        safetyBoundary: 'memory.write',
        safetyDecisionAction: 'rewrite',
        safetyPolicyId: 'memory.facts.policy.redact',
      }),
    })

    const rendered = JSON.stringify(transport.records)
    expect(rendered).not.toContain('private@example.com')
    expect(rendered).not.toContain('sk-live-secret')
    expect(rendered).toContain('[redacted-email]')
    expect(rendered).toContain('[redacted-secret]')
  })
})
