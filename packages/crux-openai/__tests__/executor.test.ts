import { describe, it, expect, vi } from 'vitest'
import { prompt as makePrompt } from '@crux/core'
import { agent as makeAgent } from '@crux/core/agent'
import { z } from 'zod'
import { createOpenAI, embedding as makeEmbedding, fromMessages } from '../index'

const simplePrompt = makePrompt({
  id: 'test-prompt',
  system: 'You are a test agent.',
})

function chatResponse(content: string | null, toolCalls?: any[]) {
  return {
    id: 'resp-1',
    object: 'chat.completion',
    created: Date.now(),
    model: 'gpt-4o',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content,
          tool_calls: toolCalls ?? undefined,
        },
        finish_reason: toolCalls?.length ? 'tool_calls' : 'stop',
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  }
}

describe('OpenAI adapter via adapter', () => {
  function createAdapter() {
    const mockCreate = vi.fn().mockResolvedValue(chatResponse('hello'))
    const mockParse = vi.fn()
    const mockClient = {
      chat: { completions: { create: mockCreate, parse: mockParse } },
    }
    return { adapter: createOpenAI(mockClient as any), mockCreate }
  }

  it('generate() calls the OpenAI API and returns result', async () => {
    const { adapter, mockCreate } = createAdapter()

    const result = await adapter.generate(simplePrompt, {
      model: 'gpt-4o',
    })

    expect(mockCreate).toHaveBeenCalledOnce()
    expect(result.text).toBe('hello')
    expect(result._meta.usage).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    })
    expect(result._meta.finishReason).toBe('stop')
  })

  it('passes system message to the API', async () => {
    const { adapter, mockCreate } = createAdapter()

    await adapter.generate(simplePrompt, {
      model: 'gpt-4o',
    })

    const args = mockCreate.mock.calls[0][0]
    expect(args.messages[0]).toEqual({ role: 'system', content: 'You are a test agent.' })
  })

  it('parallel composition works with agent', async () => {
    const { adapter } = createAdapter()
    const agent = makeAgent({ id: 'basic', prompt: simplePrompt })

    const result = await adapter.parallel({
      agents: { a: agent },
      context: {},
      model: 'gpt-4o',
    })

    expect(result.results.a.agentId).toBe('basic')
    expect(result.results.a.output).toBe('hello')
    expect(result.results.a.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('passes tools as function tools when agent has tools', async () => {
    const { adapter, mockCreate } = createAdapter()

    const agent = makeAgent({
      id: 'tooled-agent',
      prompt: simplePrompt,
      tools: {
        search: {
          description: 'Search the web',
          parameters: z.object({ query: z.string() }),
          execute: async () => 'result',
        },
      } as any,
    })

    await adapter.parallel({
      agents: { a: agent },
      context: {},
      model: 'gpt-4o',
    })

    expect(mockCreate).toHaveBeenCalled()
    const args = mockCreate.mock.calls[0][0]
    expect(args.tools).toHaveLength(1)
    expect(args.tools[0].type).toBe('function')
    expect(args.tools[0].function.name).toBe('search')
    expect(args.tools[0].function.description).toBe('Search the web')
  })

  it('executes tool loop when LLM makes tool calls', async () => {
    const executeSpy = vi.fn().mockResolvedValue('tool result')

    // First call returns tool call, second returns text
    const mockCreate = vi
      .fn()
      .mockResolvedValueOnce(
        chatResponse(null, [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'myTool', arguments: '{"q":"test"}' },
          },
        ]),
      )
      .mockResolvedValueOnce(chatResponse('final answer'))

    const mockClient = {
      chat: { completions: { create: mockCreate, parse: vi.fn() } },
    }
    const adapter = createOpenAI(mockClient as any)

    const toolPrompt = makePrompt({
      id: 'tool-prompt',
      system: 'Use tools.',
      tools: {
        myTool: {
          description: 'My tool',
          parameters: z.object({ q: z.string() }),
          execute: executeSpy,
        },
      },
    })

    const result = await adapter.generate(toolPrompt, {
      model: 'gpt-4o',
    })

    expect(executeSpy).toHaveBeenCalledWith({ q: 'test' }, expect.objectContaining({ toolCallId: 'call-1' }))
    expect(result.text).toBe('final answer')
    expect(result.steps).toBe(2)
  })

  it('has all composition methods', () => {
    const { adapter } = createAdapter()
    expect(typeof adapter.parallel).toBe('function')
    expect(typeof adapter.pipeline).toBe('function')
    expect(typeof adapter.consensus).toBe('function')
    expect(typeof adapter.swarm).toBe('function')
  })

  it('maps content tool outputs to OpenAI text content parts', () => {
    const messages = fromMessages([
      {
        role: 'tool',
        content: 'fallback',
        metadata: {
          toolCallId: 'call-1',
          toolName: 'renderImage',
          modelOutput: {
            type: 'content',
            value: [
              { type: 'text', text: 'Rendered image' },
              { type: 'image-url', url: 'https://example.com/chart.png' },
            ],
          },
        },
      },
    ])

    expect(messages[0]).toEqual({
      role: 'tool',
      content: [
        { type: 'text', text: 'Rendered image' },
        { type: 'text', text: '[image] https://example.com/chart.png' },
      ],
      tool_call_id: 'call-1',
      name: 'renderImage',
    })
  })
})

describe('embedding', () => {
  it('creates a dense embedding helper backed by client.embeddings.create()', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      object: 'list',
      model: 'text-embedding-3-small',
      data: [
        { object: 'embedding', index: 1, embedding: [0.4, 0.5, 0.6] },
        { object: 'embedding', index: 0, embedding: [0.1, 0.2, 0.3] },
      ],
      usage: { prompt_tokens: 9, total_tokens: 9 },
    })

    const client = {
      embeddings: { create: mockCreate },
    }

    const embedding = makeEmbedding(client as any, {
      name: 'openai-docs',
      model: 'text-embedding-3-small',
    })

    expect(embedding.dimensions).toBe(1536)
    expect(embedding.maxInputTokens).toBe(8192)

    const vectors = await embedding.embedMany(['First', 'Second'])

    expect(mockCreate).toHaveBeenCalledWith({
      model: 'text-embedding-3-small',
      input: ['First', 'Second'],
      encoding_format: 'float',
    })
    expect(vectors).toEqual([
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
    ])
  })

  it('requires explicit dimensions for unknown embedding models', () => {
    expect(() =>
      makeEmbedding({ embeddings: { create: vi.fn() } } as any, {
        name: 'custom',
        model: 'my-custom-embedding-model',
      }),
    ).toThrow(/requires an explicit dimensions value/i)
  })
})
