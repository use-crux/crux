import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { adapter as makeAdapter } from '../../adapter/define-adapter'
import type { AdapterResponse } from '../../adapter/types'
import { prompt as makePrompt } from '../../prompt/prompt'
import { defaultTokenizer, setTokenizer } from '../../shared/tokenizer'
import { inMemoryRecordStore, inMemoryVectorStore } from '../../storage'
import {
  episodes,
  facts,
  memory,
  memoryBlock,
  procedures,
  recentMessages,
  workingState,
} from '../../memory'

const mockEmbed = async (text: string) => {
  const values = Array.from(text.slice(0, 8)).map((char) => char.charCodeAt(0) / 255)
  while (values.length < 8) values.push(0)
  return values
}

afterEach(() => {
  setTokenizer(defaultTokenizer)
})

function mockResponse(text: string, toolCalls?: AdapterResponse['toolCalls']): AdapterResponse {
  return {
    text,
    toolCalls,
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, inputTokenDetails: {}, outputTokenDetails: {} },
    finishReason: 'stop',
    responseId: 'response-1',
    actualModelId: 'model-1',
  }
}

function testAdapter(text = 'assistant answer') {
  return makeAdapter({
    providerId: 'test',
    async call() {
      return {
        raw: { id: 'raw-1' },
        extracted: mockResponse(text),
      }
    },
    async stream() {
      async function* chunks() {
        yield { text }
      }
      return {
        rawStream: chunks(),
        extractTextDelta: (chunk) => (chunk as { text: string }).text,
        completion: async () => ({
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, inputTokenDetails: {}, outputTokenDetails: {} },
        }),
      }
    },
    appendToolRound(messages, response, toolResults) {
      return [
        ...messages,
        { role: 'assistant' as const, content: response.text },
        ...toolResults.map((result) => ({ role: 'tool' as const, content: result.content })),
      ]
    },
    mapSettings(settings) {
      return settings
    },
  })({})
}

describe('memory block system', () => {
  it('renders reusable custom blocks through memory().asContext()', async () => {
    const block = memoryBlock({
      id: 'custom',
      kind: 'custom',
      render: async (ctx) => `Namespace: ${ctx.namespace}`,
    })

    const first = memory({
      id: 'first',
      namespace: ({ input }) => `user:${input.userId}`,
      blocks: [block],
    })
    const second = memory({
      id: 'second',
      namespace: 'agent:reviewer',
      blocks: [block],
    })

    await expect(first.asContext().systemFn({ userId: 'u1' })).resolves.toContain('Namespace: user:u1')
    await expect(second.asContext().systemFn({})).resolves.toContain('Namespace: agent:reviewer')
  })

  it('uses one dynamic namespace across context, capture, direct block reads, and proposals', async () => {
    const store = inMemoryRecordStore()
    const recent = recentMessages({ id: 'recent', maxMessages: 5 })
    const factBlock = facts({
      id: 'facts',
      extract: async (_turn, ctx) => [{ content: `Captured in ${ctx.namespace}` }],
    })
    const inspector = memoryBlock({
      id: 'inspector',
      kind: 'custom',
      render: async (ctx) => `Resolved namespace: ${ctx.namespace}`,
    })
    const mem = memory({
      id: 'dynamic-contract',
      records: store,
      namespace: ({ input }) => `tenant:${input.tenantId}:thread:${input.threadId}`,
      blocks: [inspector, recent, factBlock],
    })
    const input = { tenantId: 'acme', threadId: 'support-1' }
    const namespace = 'tenant:acme:thread:support-1'

    await expect(mem.asContext().systemFn(input)).resolves.toContain(`Resolved namespace: ${namespace}`)

    await mem.captureTurn(
      {
        messages: [{ role: 'user', content: 'Remember my billing preference' }],
        source: { promptId: 'support' },
      },
      { input },
    )
    await mem.flush({ input })

    const turns = await recent.list({ records: store, namespace, memoryId: 'dynamic-contract' })
    expect(turns.map((turn) => turn.content)).toContain('Remember my billing preference')

    const proposals = await mem.proposals.list({ input })
    expect(proposals).toHaveLength(1)
    expect(proposals[0].namespace).toBe(namespace)

    await mem.proposals.approve(proposals[0].id, { input })
    const factsInNamespace = await factBlock.list({ records: store, namespace, memoryId: 'dynamic-contract' })
    expect(factsInNamespace.map((entry) => entry.content)).toEqual([`Captured in ${namespace}`])
  })

  it('throws clear errors for async namespace and async block tools on synchronous tool surfaces', () => {
    const renderOnlyMemory = memory({
      id: 'async-render-only',
      namespace: async ({ input }) => `thread:${input.threadId}`,
      blocks: [
        memoryBlock({
          id: 'render-only',
          kind: 'custom',
          render: async (ctx) => `rendered ${ctx.namespace}`,
        }),
      ],
    })

    expect(renderOnlyMemory.asTools({ input: { threadId: 't1' } })).toEqual({})

    const asyncNamespaceMemory = memory({
      id: 'async-namespace-tools',
      namespace: async ({ input }) => `thread:${input.threadId}`,
      blocks: [
        memoryBlock({
          id: 'notes',
          kind: 'custom',
          tools: () => ({
            rememberNote: {
              description: 'Remember a note.',
              parameters: z.object({ note: z.string() }),
              execute: async () => 'remembered',
            },
          }),
        }),
      ],
    })

    expect(() => asyncNamespaceMemory.asTools({ input: { threadId: 't1' } })).toThrow(
      /resolved asynchronously.*asTools\(\) is synchronous/,
    )

    const asyncToolsMemory = memory({
      id: 'async-block-tools',
      namespace: 'thread:t1',
      blocks: [
        memoryBlock({
          id: 'notes',
          kind: 'custom',
          tools: async () => ({
            rememberNote: {
              description: 'Remember a note.',
              parameters: z.object({ note: z.string() }),
              execute: async () => 'remembered',
            },
          }),
        }),
      ],
    })

    expect(() => asyncToolsMemory.asTools()).toThrow(/returned async tools.*tool collection is synchronous/)
  })

  it('awaits block capture work when capture mode is inline', async () => {
    let releaseCapture!: () => void
    const captureCanFinish = new Promise<void>((resolve) => {
      releaseCapture = resolve
    })
    const capturedNamespaces: string[] = []
    const mem = memory({
      id: 'inline-capture',
      namespace: ({ input }) => `thread:${input.threadId}`,
      capture: { mode: 'inline' },
      blocks: [
        memoryBlock({
          id: 'capture',
          kind: 'custom',
          captureTurn: async (_turn, ctx) => {
            await captureCanFinish
            capturedNamespaces.push(ctx.namespace)
          },
        }),
      ],
    })

    let resolved = false
    const capture = mem
      .captureTurn({ messages: [{ role: 'user', content: 'hi' }] }, { input: { threadId: 't1' } })
      .then(() => {
        resolved = true
      })

    await Promise.resolve()
    expect(resolved).toBe(false)

    releaseCapture()
    await capture
    expect(capturedNamespaces).toEqual(['thread:t1'])
  })

  it('allows memory() directly in prompt use and merges block tools', async () => {
    const mem = memory({
      id: 'prompt-memory',
      namespace: 'thread:1',
      blocks: [
        memoryBlock({
          id: 'notes',
          kind: 'custom',
          render: async () => 'Remember the user likes short answers.',
          tools: () => ({
            rememberNote: {
              description: 'Remember a note.',
              parameters: z.object({ note: z.string() }),
              execute: async ({ note }: { note: string }) => `remembered ${note}`,
            },
          }),
        }),
      ],
    })

    const p = makePrompt({
      id: 'with-memory',
      use: [mem],
      input: z.object({ message: z.string() }),
      system: 'You are helpful.',
      prompt: ({ input }) => input.message,
    })
    const resolved = await p.resolve({ input: { message: 'Hi' } })

    expect(resolved.system).toContain('Remember the user likes short answers.')
    expect(resolved.tools).toHaveProperty('rememberNote')
    expect(resolved.memoryBindings).toHaveLength(1)
  })

  it('enforces internal memory and block budgets before resolver composition', async () => {
    setTokenizer((text) => (text.trim() ? text.trim().split(/\s+/).length : 0))
    const mem = memory({
      id: 'budgeted',
      namespace: 'thread:1',
      budget: { maxTokens: 6 },
      blocks: [
        memoryBlock({
          id: 'important',
          kind: 'custom',
          priority: 90,
          budget: { maxTokens: 2 },
          render: () => 'alpha beta gamma',
        }),
        memoryBlock({
          id: 'noisy',
          kind: 'custom',
          priority: 10,
          render: () => 'low priority detail',
        }),
      ],
    })

    const rendered = await mem.asContext().systemFn({})

    expect(rendered).toContain('## Memory: important')
    expect(rendered).toContain('alpha beta')
    expect(rendered).not.toContain('gamma')
    expect(rendered).not.toContain('low priority detail')
  })

  it('captures completed adapter turns after generation and flushes deferred work', async () => {
    const store = inMemoryRecordStore()
    const recent = recentMessages({ id: 'recent', maxMessages: 5 })
    const mem = memory({
      id: 'capture',
      records: store,
      namespace: ({ input }) => `thread:${input.threadId}`,
      blocks: [recent],
    })
    const p = makePrompt({
      id: 'capture-prompt',
      use: [mem],
      input: z.object({ threadId: z.string(), message: z.string() }),
      system: 'You are helpful.',
      prompt: ({ input }) => input.message,
    })

    const adapter = testAdapter('stored answer')
    await adapter.generate(p, {
      model: 'model-1',
      input: { threadId: 't1', message: 'Hello' },
    })
    await mem.flush()

    const turns = await recent.list({ records: store, namespace: 'thread:t1', memoryId: 'capture' })
    expect(turns.map((turn) => turn.role)).toEqual(['user', 'assistant'])
    expect(turns[1].content).toBe('stored answer')
  })

  it('supports standalone working state blocks', async () => {
    const store = inMemoryRecordStore()
    const state = workingState({
      id: 'state',
      schema: z.object({ step: z.number(), goal: z.string() }),
    })

    await state.set({ step: 1, goal: 'draft' }, { records: store, namespace: 'thread:1' })
    await state.patch({ step: 2 }, { records: store, namespace: 'thread:1' })

    await expect(state.get({ records: store, namespace: 'thread:1' })).resolves.toEqual({
      step: 2,
      goal: 'draft',
    })
  })

  it('supports standalone episodes with dense recall', async () => {
    const store = inMemoryRecordStore()
    const vectors = inMemoryVectorStore()
    const ep = episodes({ id: 'episodes', embed: mockEmbed })

    await ep.record({ content: 'User asked about pricing' }, { records: store, vectors, namespace: 'user:1' })
    await ep.record({ content: 'We discussed React hooks' }, { records: store, vectors, namespace: 'user:1' })

    const results = await ep.recall('pricing', { records: store, vectors, namespace: 'user:1', limit: 1 })
    expect(results).toHaveLength(1)
    expect(results[0].score).toBeDefined()
  })

  it('creates fact proposals by default and approves them through memory()', async () => {
    const store = inMemoryRecordStore()
    const factBlock = facts({
      id: 'facts',
      extract: async () => [{ content: 'User prefers concise answers', confidence: 0.9 }],
    })
    const mem = memory({
      id: 'proposals',
      records: store,
      namespace: 'user:1',
      blocks: [factBlock],
    })

    await mem.captureTurn({
      messages: [{ role: 'user', content: 'Please be concise' }],
      source: { promptId: 'p1' },
    })
    await mem.flush()

    const proposals = await mem.proposals.list({ namespace: 'user:1' })
    expect(proposals).toHaveLength(1)
    expect(proposals[0].status).toBe('pending')

    await mem.proposals.approve(proposals[0].id)
    const stored = await factBlock.list({ records: store, namespace: 'user:1', memoryId: 'proposals' })
    expect(stored).toHaveLength(1)
    expect(stored[0].content).toBe('User prefers concise answers')
  })

  it('keeps proposal approval, rejection, and editing pending-only', async () => {
    const store = inMemoryRecordStore()
    let content = 'User prefers concise answers'
    const factBlock = facts({
      id: 'facts',
      extract: async () => [{ content, confidence: 0.9 }],
    })
    const mem = memory({
      id: 'proposal-lifecycle',
      records: store,
      namespace: 'user:1',
      blocks: [factBlock],
      capture: { mode: 'inline' },
    })

    await mem.captureTurn({ messages: [{ role: 'user', content: 'Please be concise' }] })
    const [approvedProposal] = await mem.proposals.list({ namespace: 'user:1', status: 'pending' })
    expect(approvedProposal).toBeDefined()

    await mem.proposals.approve(approvedProposal.id)
    await expect(mem.proposals.approve(approvedProposal.id)).rejects.toThrow(/pending/i)
    await expect(mem.proposals.edit(approvedProposal.id, { content: 'Changed' })).rejects.toThrow(/pending/i)
    await expect(mem.proposals.reject(approvedProposal.id)).rejects.toThrow(/pending/i)

    let stored = await factBlock.list({ records: store, namespace: 'user:1', memoryId: 'proposal-lifecycle' })
    expect(stored.map((entry) => entry.content)).toEqual(['User prefers concise answers'])

    content = 'User likes short bullet lists'
    await mem.captureTurn({ messages: [{ role: 'user', content: 'Use bullets' }] })
    const [rejectedProposal] = await mem.proposals.list({ namespace: 'user:1', status: 'pending' })
    expect(rejectedProposal).toBeDefined()

    await mem.proposals.edit(rejectedProposal.id, { content: 'User likes edited bullet lists' })
    await mem.proposals.reject(rejectedProposal.id, { reason: 'not enough evidence' })
    await expect(mem.proposals.approve(rejectedProposal.id)).rejects.toThrow(/pending/i)
    await expect(mem.proposals.reject(rejectedProposal.id)).rejects.toThrow(/pending/i)
    await expect(mem.proposals.edit(rejectedProposal.id, { content: 'Changed again' })).rejects.toThrow(/pending/i)

    stored = await factBlock.list({ records: store, namespace: 'user:1', memoryId: 'proposal-lifecycle' })
    expect(stored.map((entry) => entry.content)).toEqual(['User prefers concise answers'])
  })

  it('allows extractive blocks to customize prompt rendering', async () => {
    const store = inMemoryRecordStore()
    const factBlock = facts({
      id: 'facts',
      write: { mode: 'auto' },
      render: async (ctx, api) => {
        const entries = await api.find(String(ctx.input?.query ?? ''), { ...ctx, limit: 1 })
        return entries.length ? `Relevant fact: ${entries[0].content}` : ''
      },
    })
    await factBlock.add({ content: 'User prefers concise answers' }, { records: store, namespace: 'user:1', memoryId: 'facts' })
    const mem = memory({
      id: 'facts',
      records: store,
      namespace: 'user:1',
      blocks: [factBlock],
    })

    await expect(mem.asContext().systemFn({ query: 'concise' })).resolves.toContain(
      'Relevant fact: User prefers concise answers',
    )
  })

  it('renders extractive blocks with an explicit semantic strategy scoped to namespace and block id', async () => {
    const store = inMemoryRecordStore()
    const vectors = inMemoryVectorStore()
    const semanticEmbed = async (text: string) => (text.toLowerCase().includes('billing') ? [1, 0] : [0, 1])
    const factBlock = facts({
      id: 'facts',
      embed: semanticEmbed,
      render: {
        strategy: 'semantic',
        query: ({ input }) => String(input?.query ?? ''),
        limit: 1,
      },
      write: { mode: 'auto' },
    })
    const otherBlock = facts({
      id: 'other-facts',
      embed: semanticEmbed,
      write: { mode: 'auto' },
    })
    const mem = memory({
      id: 'semantic-render',
      records: store,
      vectors,
      namespace: 'user:1',
      blocks: [factBlock],
    })

    await factBlock.add(
      { content: 'Billing contact is finance@example.com.' },
      { records: store, vectors, namespace: 'user:1', memoryId: mem.id },
    )
    await factBlock.add(
      { content: 'Billing contact is someone else.' },
      { records: store, vectors, namespace: 'user:2', memoryId: mem.id },
    )
    await otherBlock.add(
      { content: 'Billing contact in another block.' },
      { records: store, vectors, namespace: 'user:1', memoryId: mem.id },
    )
    await factBlock.add(
      { content: 'Shipping address is Amsterdam.' },
      { records: store, vectors, namespace: 'user:1', memoryId: mem.id },
    )

    const rendered = await mem.asContext().systemFn({ query: 'billing' })

    expect(rendered).toContain('Billing contact is finance@example.com.')
    expect(rendered).not.toContain('someone else')
    expect(rendered).not.toContain('another block')
    expect(rendered).not.toContain('Shipping address')
  })

  it('supports procedural memories without mutating prompt definitions', async () => {
    const store = inMemoryRecordStore()
    const proc = procedures({ id: 'procedures' })
    await proc.add(
      { content: 'Prefer direct answers before examples.', confidence: 0.8 },
      { records: store, namespace: 'agent:writer' },
    )

    const rendered = await proc.render({ records: store, namespace: 'agent:writer' })
    expect(rendered).toContain('Operating Memory')
    expect(rendered).toContain('Prefer direct answers before examples.')
  })
})
