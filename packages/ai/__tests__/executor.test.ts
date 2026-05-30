import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prompt as makePrompt } from '@crux/core'
import { agent as makeAgent } from '@crux/core/agent'
import { approvalMiddleware, toolApprovalResponse } from '@crux/core/tool-middleware'
import { z } from 'zod'

// Mock the 'ai' module
vi.mock('ai', () => ({
  embedMany: vi.fn(),
  generateObject: vi.fn(),
  generateText: vi.fn(),
  streamObject: vi.fn(),
  streamText: vi.fn(),
  rerank: vi.fn(),
  jsonSchema: vi.fn((s: any) => s),
  tool: vi.fn(),
  stepCountIs: vi.fn((n: number) => ({ _type: 'stepCountIs', count: n })),
  hasToolCall: vi.fn(),
}))

import { embedMany, generateText, rerank } from 'ai'
import { createAIExecutor, embedding as makeEmbedding, generate, reranker as makeReranker } from '../index'

function mockModel(id = 'test-model', provider = 'test'): any {
  return {
    provider,
    modelId: id,
    specificationVersion: 'v1',
    defaultObjectGenerationMode: 'json',
  }
}

function textResponse(text: string) {
  return {
    text,
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    finishReason: 'stop',
    response: { id: 'resp-1' },
    providerMetadata: {},
  }
}

const textPrompt = makePrompt({
  id: 'test-prompt',
  input: z.object({ message: z.string() }),
  system: 'You are a test agent',
})

const agent = makeAgent({ id: 'test-agent', prompt: textPrompt })

describe('createAIExecutor', () => {
  const executor = createAIExecutor()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(generateText).mockResolvedValue(textResponse('hello') as any)
  })

  it('does not pass stopWhen when maxSteps is omitted', async () => {
    await executor(agent, {
      input: { message: 'hi' },
      model: mockModel(),
    })

    expect(generateText).toHaveBeenCalledOnce()
    const callArgs = vi.mocked(generateText).mock.calls[0][0] as any
    expect(callArgs.stopWhen).toBeUndefined()
  })

  it('does not pass stopWhen when maxSteps is 1', async () => {
    await executor(agent, {
      input: { message: 'hi' },
      model: mockModel(),
      maxSteps: 1,
    })

    expect(generateText).toHaveBeenCalledOnce()
    const callArgs = vi.mocked(generateText).mock.calls[0][0] as any
    expect(callArgs.stopWhen).toBeUndefined()
  })

  it('passes stopWhen: stepCountIs(N) when maxSteps > 1', async () => {
    await executor(agent, {
      input: { message: 'hi' },
      model: mockModel(),
      maxSteps: 5,
    })

    expect(generateText).toHaveBeenCalledOnce()
    const callArgs = vi.mocked(generateText).mock.calls[0][0] as any
    expect(callArgs.stopWhen).toEqual({ _type: 'stepCountIs', count: 5 })
  })

  it('merges agent tools with options tools', async () => {
    const agentWithTools = makeAgent({
      id: 'tooled-agent',
      prompt: textPrompt,
      tools: { agentTool: { description: 'agent tool' } } as any,
    })

    await executor(agentWithTools, {
      input: { message: 'hi' },
      model: mockModel(),
      tools: { optionTool: { description: 'option tool' } } as any,
    })

    expect(generateText).toHaveBeenCalledOnce()
    const callArgs = vi.mocked(generateText).mock.calls[0][0] as any
    // Both tools should be merged (options.tools overrides agent.tools)
    expect(callArgs.tools).toHaveProperty('agentTool')
    expect(callArgs.tools).toHaveProperty('optionTool')
  })

  it('returns normalized AgentResult', async () => {
    const result = await executor(agent, {
      input: { message: 'hi' },
      model: mockModel(),
    })

    expect(result.agentId).toBe('test-agent')
    expect(result.output).toBe('hello')
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
    expect(result.usage).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    })
  })
})

describe('reranker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps AI SDK rerank results back onto RetrieverHit objects', async () => {
    vi.mocked(rerank).mockResolvedValue({
      originalDocuments: ['First', 'Second'],
      rerankedDocuments: ['Second'],
      ranking: [{ originalIndex: 1, score: 0.97, document: 'Second' }],
      response: { timestamp: new Date(), modelId: 'reranker-1' },
    } as any)

    const reranker = makeReranker({
      name: 'sdk-reranker',
      model: { provider: 'test', modelId: 'reranker-1' } as any,
      topN: 1,
    })

    const hits = await reranker.rerank({
      retrieverId: 'docs',
      namespace: 'kb',
      mode: 'dense',
      query: 'pricing',
      hits: [
        {
          namespace: 'kb',
          sourceId: 'a',
          chunkId: '0',
          content: 'First',
          metadata: {},
          score: 0.6,
        },
        {
          namespace: 'kb',
          sourceId: 'b',
          chunkId: '1',
          content: 'Second',
          metadata: {},
          score: 0.5,
        },
      ],
    })

    expect(rerank).toHaveBeenCalledWith({
      model: { provider: 'test', modelId: 'reranker-1' },
      query: 'pricing',
      documents: ['First', 'Second'],
      topN: 1,
      maxRetries: undefined,
    })
    expect(hits).toEqual([
      {
        namespace: 'kb',
        sourceId: 'b',
        chunkId: '1',
        content: 'Second',
        metadata: {},
        score: 0.97,
      },
    ])
  })
})

describe('embedding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps AI SDK embedMany() into a dense Crux embedding', async () => {
    vi.mocked(embedMany).mockResolvedValue({
      values: ['First', 'Second'],
      embeddings: [
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ],
      usage: { tokens: 12 },
      warnings: [],
    } as any)

    const embedding = makeEmbedding({
      name: 'sdk-embedding',
      model: { provider: 'test', modelId: 'embed-1' } as any,
      dimensions: 3,
      maxInputTokens: 8192,
    })

    const vectors = await embedding.embedMany(['First', 'Second'])

    expect(embedMany).toHaveBeenCalledWith({
      model: { provider: 'test', modelId: 'embed-1' },
      values: ['First', 'Second'],
      maxRetries: undefined,
      maxParallelCalls: 1,
      headers: undefined,
      providerOptions: undefined,
    })
    expect(vectors).toEqual([
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
    ])
  })
})

describe('generate tool approval middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(generateText).mockResolvedValue(textResponse('approval requested') as never)
  })

  it('maps approval middleware to AI SDK needsApproval', async () => {
    await generate(textPrompt, {
      model: mockModel(),
      input: { message: 'send it' },
      tools: {
        sendEmail: {
          description: 'Send email',
          inputSchema: z.object({ subject: z.string() }),
          execute: async () => 'sent',
        },
      },
      toolMiddleware: approvalMiddleware({
        id: 'approval',
        match: ['sendEmail'],
      }),
    })

    const callArgs = vi.mocked(generateText).mock.calls[0][0] as {
      tools?: Record<
        string,
        {
          needsApproval?: (
            input: unknown,
            options: { toolCallId?: string; messages?: readonly unknown[] },
          ) => boolean | PromiseLike<boolean>
        }
      >
    }
    await expect(callArgs.tools?.sendEmail.needsApproval?.({ subject: 'Hello' }, { toolCallId: 'call-1' })).resolves.toBe(
      true,
    )
  })

  it('notifies approval callbacks from resumed message history', async () => {
    const onDenied = vi.fn()
    const messages = [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'sendEmail',
            input: { subject: 'Hello' },
          },
          {
            type: 'tool-approval-request',
            approvalId: 'approval-1',
            toolCallId: 'call-1',
          },
        ],
      },
      {
        role: 'tool',
        content: [toolApprovalResponse({ approvalId: 'approval-1', approved: false, reason: 'No' })],
      },
    ]

    await generate(textPrompt, {
      model: mockModel(),
      input: { message: 'send it' },
      messages,
      tools: {
        sendEmail: {
          description: 'Send email',
          inputSchema: z.object({ subject: z.string() }),
          execute: async () => 'sent',
        },
      },
      toolMiddleware: approvalMiddleware({
        id: 'approval',
        match: ['sendEmail'],
        onDenied,
      }),
    })

    expect(onDenied).toHaveBeenCalledWith(
      expect.objectContaining({
        approvalId: 'approval-1',
        status: 'denied',
        toolName: 'sendEmail',
      }),
    )
    const callArgs = vi.mocked(generateText).mock.calls[0][0] as { messages?: unknown[]; prompt?: string }
    expect(callArgs.messages).toEqual(messages)
    expect(callArgs.prompt).toBeUndefined()
  })
})
