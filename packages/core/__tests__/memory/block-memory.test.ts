import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { adapter as makeAdapter } from '../../adapter/define-adapter'
import type { AdapterResponse } from '../../adapter/types'
import { prompt as makePrompt } from '../../define'
import { inMemoryCruxStore } from '../../store/memory'
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

function mockResponse(text: string, toolCalls?: AdapterResponse['toolCalls']): AdapterResponse {
  return {
    text,
    toolCalls,
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
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
        completion: async () => ({ usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }),
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

  it('captures completed adapter turns after generation and flushes deferred work', async () => {
    const store = inMemoryCruxStore()
    const recent = recentMessages({ id: 'recent', maxMessages: 5 })
    const mem = memory({
      id: 'capture',
      store,
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

    const turns = await recent.list({ store, namespace: 'thread:t1', memoryId: 'capture' })
    expect(turns.map((turn) => turn.role)).toEqual(['user', 'assistant'])
    expect(turns[1].content).toBe('stored answer')
  })

  it('supports standalone working state blocks', async () => {
    const store = inMemoryCruxStore()
    const state = workingState({
      id: 'state',
      schema: z.object({ step: z.number(), goal: z.string() }),
    })

    await state.set({ step: 1, goal: 'draft' }, { store, namespace: 'thread:1' })
    await state.patch({ step: 2 }, { store, namespace: 'thread:1' })

    await expect(state.get({ store, namespace: 'thread:1' })).resolves.toEqual({
      step: 2,
      goal: 'draft',
    })
  })

  it('supports standalone episodes with dense recall', async () => {
    const store = inMemoryCruxStore()
    const ep = episodes({ id: 'episodes', embed: mockEmbed })

    await ep.record({ content: 'User asked about pricing' }, { store, namespace: 'user:1' })
    await ep.record({ content: 'We discussed React hooks' }, { store, namespace: 'user:1' })

    const results = await ep.recall('pricing', { store, namespace: 'user:1', limit: 1 })
    expect(results).toHaveLength(1)
    expect(results[0].score).toBeDefined()
  })

  it('creates fact proposals by default and approves them through memory()', async () => {
    const store = inMemoryCruxStore()
    const factBlock = facts({
      id: 'facts',
      extract: async () => [{ content: 'User prefers concise answers', confidence: 0.9 }],
    })
    const mem = memory({
      id: 'proposals',
      store,
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
    const stored = await factBlock.list({ store, namespace: 'user:1', memoryId: 'proposals' })
    expect(stored).toHaveLength(1)
    expect(stored[0].content).toBe('User prefers concise answers')
  })

  it('allows extractive blocks to customize prompt rendering', async () => {
    const store = inMemoryCruxStore()
    const factBlock = facts({
      id: 'facts',
      write: { mode: 'auto' },
      render: async (ctx, api) => {
        const entries = await api.find(String(ctx.input?.query ?? ''), { ...ctx, limit: 1 })
        return entries.length ? `Relevant fact: ${entries[0].content}` : ''
      },
    })
    await factBlock.add({ content: 'User prefers concise answers' }, { store, namespace: 'user:1', memoryId: 'facts' })
    const mem = memory({
      id: 'facts',
      store,
      namespace: 'user:1',
      blocks: [factBlock],
    })

    await expect(mem.asContext().systemFn({ query: 'concise' })).resolves.toContain(
      'Relevant fact: User prefers concise answers',
    )
  })

  it('supports procedural memories without mutating prompt definitions', async () => {
    const store = inMemoryCruxStore()
    const proc = procedures({ id: 'procedures' })
    await proc.add(
      { content: 'Prefer direct answers before examples.', confidence: 0.8 },
      { store, namespace: 'agent:writer' },
    )

    const rendered = await proc.render({ store, namespace: 'agent:writer' })
    expect(rendered).toContain('Operating Memory')
    expect(rendered).toContain('Prefer direct answers before examples.')
  })
})
