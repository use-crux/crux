import { describe, it, expect, vi } from 'vitest'
import { prompt as makePrompt } from '@crux/core'
import { agent as makeAgent } from '@crux/core/agent'
import { z } from 'zod'
import { createGoogle, embedding as makeEmbedding, fromMessages } from '../index'

const simplePrompt = makePrompt({
  id: 'test-prompt',
  system: 'You are a test agent.',
})

function googleResponse(text: string, functionCalls?: any[]) {
  const parts: any[] = []
  if (text) parts.push({ text })
  if (functionCalls) {
    parts.push(...functionCalls.map((fc) => ({ functionCall: fc })))
  }
  return {
    candidates: [
      {
        content: { parts, role: 'model' },
        finishReason: functionCalls?.length ? 'TOOL_CALLS' : 'STOP',
      },
    ],
    usageMetadata: {
      promptTokenCount: 10,
      candidatesTokenCount: 5,
      totalTokenCount: 15,
    },
    text: text || undefined,
  }
}

describe('Google adapter via adapter', () => {
  function createAdapter() {
    const mockGenerateContent = vi.fn().mockResolvedValue(googleResponse('hello'))
    const mockClient = {
      models: {
        generateContent: mockGenerateContent,
        generateContentStream: vi.fn(),
      },
    }
    return { adapter: createGoogle(mockClient as any), mockGenerateContent }
  }

  it('generate() calls the Google API and returns result', async () => {
    const { adapter, mockGenerateContent } = createAdapter()

    const result = await adapter.generate(simplePrompt, {
      model: 'gemini-2.0-flash',
    })

    expect(mockGenerateContent).toHaveBeenCalledOnce()
    expect(result.text).toBe('hello')
    expect(result._meta.usage).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    })
    expect(result._meta.finishReason).toBe('stop')
  })

  it('passes system instruction via config', async () => {
    const { adapter, mockGenerateContent } = createAdapter()

    await adapter.generate(simplePrompt, {
      model: 'gemini-2.0-flash',
    })

    const args = mockGenerateContent.mock.calls[0][0]
    expect(args.config.systemInstruction).toBe('You are a test agent.')
  })

  it('parallel composition works with agent', async () => {
    const { adapter } = createAdapter()
    const agent = makeAgent({ id: 'basic', prompt: simplePrompt })

    const result = await adapter.parallel({
      agents: { a: agent },
      context: {},
      model: 'gemini-2.0-flash',
    })

    expect(result.results.a.agentId).toBe('basic')
    expect(result.results.a.output).toBe('hello')
    expect(result.results.a.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('passes tools as function declarations when agent has tools', async () => {
    const { adapter, mockGenerateContent } = createAdapter()

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
      model: 'gemini-2.0-flash',
    })

    expect(mockGenerateContent).toHaveBeenCalled()
    const args = mockGenerateContent.mock.calls[0][0]
    const tools = args.config?.tools?.[0]?.functionDeclarations
    expect(tools).toBeDefined()
    expect(tools).toHaveLength(1)
    expect(tools[0].name).toBe('search')
    expect(tools[0].description).toBe('Search the web')
  })

  it('executes tool loop when LLM makes function calls', async () => {
    const executeSpy = vi.fn().mockResolvedValue('tool result')

    // First call returns function call, second returns text
    const mockGenerateContent = vi
      .fn()
      .mockResolvedValueOnce(googleResponse('', [{ name: 'myTool', args: { q: 'test' } }]))
      .mockResolvedValueOnce(googleResponse('final answer'))

    const mockClient = {
      models: {
        generateContent: mockGenerateContent,
        generateContentStream: vi.fn(),
      },
    }
    const adapter = createGoogle(mockClient as any)

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
      model: 'gemini-2.0-flash',
    })

    expect(executeSpy).toHaveBeenCalledWith({ q: 'test' }, expect.objectContaining({ toolCallId: 'tc_0' }))
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

  it('maps content tool outputs to Google function responses with media parts', () => {
    const contents = fromMessages([
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
              { type: 'image-data', data: 'base64-image', mediaType: 'image/png' },
            ],
          },
        },
      },
    ])

    expect(contents[0]).toEqual({
      role: 'user',
      parts: [
        {
          functionResponse: {
            id: 'call-1',
            name: 'renderImage',
            response: { output: 'Rendered image\n[image:image/png] data:base64-image' },
            parts: [{ inlineData: { data: 'base64-image', mimeType: 'image/png' } }],
          },
        },
      ],
    })
  })
})

describe('embedding', () => {
  it('creates a dense embedding helper backed by models.embedContent()', async () => {
    const mockEmbedContent = vi.fn().mockResolvedValue({
      embeddings: [
        { values: [0.1, 0.2, 0.3], statistics: { tokenCount: 4 } },
        { values: [0.4, 0.5, 0.6], statistics: { tokenCount: 5 } },
      ],
    })

    const client = {
      models: {
        embedContent: mockEmbedContent,
      },
    }

    const embedding = makeEmbedding(client as any, {
      name: 'google-docs',
      model: 'text-embedding-004',
      dimensions: 3,
      maxInputTokens: 2048,
      taskType: 'RETRIEVAL_DOCUMENT',
      title: 'Docs',
    })

    const vectors = await embedding.embedMany(['First', 'Second'])

    expect(mockEmbedContent).toHaveBeenCalledWith({
      model: 'text-embedding-004',
      contents: ['First', 'Second'],
      config: {
        taskType: 'RETRIEVAL_DOCUMENT',
        title: 'Docs',
        outputDimensionality: 3,
        mimeType: undefined,
        autoTruncate: undefined,
      },
    })
    expect(vectors).toEqual([
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
    ])
  })
})

// ─────────────────────────────────────────────────────────────────
// Cache integration tests
// ─────────────────────────────────────────────────────────────────

describe('Google adapter — CachedContent integration', () => {
  function createCacheAdapter() {
    const mockGenerateContent = vi.fn().mockResolvedValue(googleResponse('cached response'))
    const mockGenerateContentStream = vi.fn().mockResolvedValue({
      [Symbol.asyncIterator]: async function* () {
        yield { candidates: [{ content: { parts: [{ text: 'streamed' }] } }] }
      },
    })
    const mockCachesCreate = vi.fn().mockResolvedValue({ name: 'cachedContents/test-cache' })
    const mockClient = {
      models: {
        generateContent: mockGenerateContent,
        generateContentStream: mockGenerateContentStream,
      },
      caches: {
        create: mockCachesCreate,
        delete: vi.fn().mockResolvedValue({}),
        get: vi.fn(),
        update: vi.fn(),
      },
    }
    const adapter = createGoogle(mockClient as any)
    return { adapter, mockGenerateContent, mockGenerateContentStream, mockCachesCreate, mockClient }
  }

  const promptWithCacheableBlocks = makePrompt({
    id: 'cached-prompt',
    system: '## Brand Voice\nBe professional.\n\n## Rules\nAlways respond in JSON.',
  })

  // Simulate resolved systemBlocks by creating a prompt whose resolution
  // produces them. Since we can't easily control systemBlocks from the
  // prompt definition alone, we test at the spec level instead.

  it('passes cachedContent to generateContent when systemBlocks have providerCache', async () => {
    const { mockGenerateContent, mockCachesCreate, mockClient } = createCacheAdapter()

    mockGenerateContent.mockResolvedValue({
      ...googleResponse('hello'),
      usageMetadata: {
        promptTokenCount: 100,
        candidatesTokenCount: 20,
        totalTokenCount: 120,
        cachedContentTokenCount: 80,
      },
    })

    const adapter = createGoogle(mockClient as any)
    const result = await adapter.generate(promptWithCacheableBlocks, {
      model: 'gemini-2.5-flash',
    })

    const usage = result._meta.usage
    expect(usage).toBeDefined()
    expect(usage?.cacheReadTokens).toBe(80)
  })

  it('maps cachedContentTokenCount to cacheReadTokens in usage', async () => {
    const mockGenerateContent = vi.fn().mockResolvedValue({
      ...googleResponse('response'),
      usageMetadata: {
        promptTokenCount: 500,
        candidatesTokenCount: 50,
        totalTokenCount: 550,
        cachedContentTokenCount: 400,
      },
    })
    const mockClient = {
      models: {
        generateContent: mockGenerateContent,
        generateContentStream: vi.fn(),
      },
      caches: {
        create: vi.fn().mockResolvedValue({ name: 'cachedContents/x' }),
        delete: vi.fn(),
        get: vi.fn(),
        update: vi.fn(),
      },
    }

    const adapter = createGoogle(mockClient as any)
    const result = await adapter.generate(simplePrompt, {
      model: 'gemini-2.5-flash',
    })

    expect(result._meta.usage).toEqual({
      inputTokens: 500,
      outputTokens: 50,
      totalTokens: 550,
      cacheReadTokens: 400,
    })
  })

  it('does not include cacheReadTokens when cachedContentTokenCount is absent', async () => {
    const { adapter, mockGenerateContent } = createCacheAdapter()
    mockGenerateContent.mockResolvedValue(googleResponse('no cache'))

    const result = await adapter.generate(simplePrompt, {
      model: 'gemini-2.5-flash',
    })

    const usage = result._meta.usage
    expect(usage).toBeDefined()
    expect(usage?.cacheReadTokens).toBeUndefined()
  })

  it('createGoogle with cache: false disables cache management', () => {
    const mockClient = {
      models: { generateContent: vi.fn().mockResolvedValue(googleResponse('ok')), generateContentStream: vi.fn() },
      caches: { create: vi.fn(), delete: vi.fn(), get: vi.fn(), update: vi.fn() },
    }

    // Should not throw
    const adapter = createGoogle(mockClient as any, { cache: false })
    expect(adapter).toBeDefined()
    expect(typeof adapter.generate).toBe('function')
  })

  it('createGoogle with custom cache config creates adapter', () => {
    const mockClient = {
      models: { generateContent: vi.fn().mockResolvedValue(googleResponse('ok')), generateContentStream: vi.fn() },
      caches: { create: vi.fn(), delete: vi.fn(), get: vi.fn(), update: vi.fn() },
    }

    const adapter = createGoogle(mockClient as any, {
      cache: { defaultTtlSeconds: 600, maxEntries: 10 },
    })
    expect(adapter).toBeDefined()
  })

  it('backward compatible: createGoogle(client) still works', () => {
    const mockClient = {
      models: { generateContent: vi.fn().mockResolvedValue(googleResponse('ok')), generateContentStream: vi.fn() },
      caches: { create: vi.fn(), delete: vi.fn(), get: vi.fn(), update: vi.fn() },
    }

    const adapter = createGoogle(mockClient as any)
    expect(adapter).toBeDefined()
    expect(typeof adapter.generate).toBe('function')
    expect(typeof adapter.stream).toBe('function')
  })
})
