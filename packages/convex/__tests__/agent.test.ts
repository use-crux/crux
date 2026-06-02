import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { Agent as ConvexAgentBase, createTool } from '@convex-dev/agent'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '@crux/core/observability'
import { Agent, convexTools, createAgent, createTool as createCruxTool, wrapConvexTool } from '../agent'
import type { CruxConvexContext } from '../server'
import { tool as convexRuntimeTool } from '../tools'
import { inMemoryCruxStore } from '../memory'
import { runWithConvexCruxRuntime } from '../runtime'

describe('convexTools', () => {
  afterEach(() => {
    resetObservabilityRuntime()
  })

  it('converts Crux tool definitions to Convex Agent tools', async () => {
    const execute = vi.fn(async (args: Record<string, unknown>) => `hello ${args.name}`)

    const tools = convexTools({
      greet: {
        description: 'Greet a user.',
        parameters: z.object({ name: z.string() }),
        execute,
      },
    })

    expect(tools.greet.description).toBe('Greet a user.')
    expect(tools.greet.inputSchema).toBeDefined()

    const result = await tools.greet.execute?.call({ ctx: {} }, { name: 'Ada' }, {} as any)

    expect(result).toBe('hello Ada')
    expect(execute).toHaveBeenCalledWith({ name: 'Ada' })
  })

  it('propagates tool execution errors', async () => {
    const tools = convexTools({
      fail: {
        description: 'Fail.',
        parameters: z.object({}),
        execute: async () => {
          throw new Error('boom')
        },
      },
    })

    await expect(tools.fail.execute?.call({ ctx: {} }, {}, {} as any)).rejects.toThrow('boom')
  })

  it('records Crux tool execution errors with Convex tool metadata', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const tools = convexTools({
      fail: {
        description: 'Fail.',
        parameters: z.object({}),
        execute: async () => {
          const error = new Error('convex crux boom')
          error.stack = 'Error: convex crux boom\n    at convex crux tool'
          throw error
        },
      },
    })

    await expect(
      observe.run({ name: 'chat', rootPrimitive: 'agent.run' }, async () => {
        await tools.fail.execute?.call({ ctx: {} }, {}, { toolCallId: 'call_fail', messages: [] })
      }),
    ).rejects.toThrow('convex crux boom')
    await observe.flush()

    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:event',
        name: 'exception',
        attributes: expect.objectContaining({
          toolName: 'fail',
          toolCallId: 'call_fail',
          phase: 'tool.execute',
          errorKind: 'execute_error',
          'error.phase': 'tool.execute',
          'error.kind': 'execute_error',
          'exception.message': 'convex crux boom',
        }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'error.stack',
        attributes: expect.objectContaining({ toolName: 'fail', toolCallId: 'call_fail' }),
        preview: expect.stringContaining('convex crux boom'),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:end',
        status: 'error',
        error: { message: 'convex crux boom', name: 'Error', category: 'execute_error' },
        attributes: expect.objectContaining({
          toolName: 'fail',
          toolCallId: 'call_fail',
          phase: 'tool.execute',
          errorKind: 'execute_error',
        }),
      }),
    )
  })

  it('preserves captured Convex runtime and toolCallId for prompt-resolved Crux tools', async () => {
    const runtimeTool = convexRuntimeTool({
      name: 'runtimeLookup',
      description: 'Read runtime metadata.',
      input: z.object({ query: z.string() }),
      execute: ({ input, target }) => ({
        query: input.query,
        threadId: target.threadId,
        toolCallId: target.toolCallId,
      }),
    })
    const tools = runWithConvexCruxRuntime(
      {
        ctx: {},
        store: inMemoryCruxStore(),
        target: { threadId: 'thread-runtime' },
      },
      () => convexTools({ runtimeLookup: runtimeTool }),
    )
    const executable = tools.runtimeLookup as {
      execute?: (this: unknown, input: unknown, options?: { toolCallId?: string }) => unknown | Promise<unknown>
    }

    const result = await executable.execute?.call(
      { ctx: {} },
      { query: 'crux' },
      { toolCallId: 'call_runtime' },
    )

    expect(result).toEqual({
      query: 'crux',
      threadId: 'thread-runtime',
      toolCallId: 'call_runtime',
    })
  })

  it('does not double-wrap prompt-resolved Crux tools when installed on an Agent', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const tools = convexTools({
      search: {
        description: 'Search.',
        parameters: z.object({ query: z.string() }),
        execute: async () => 'ok',
      },
    })
    const agent = new Agent({} as never, {
      name: 'Karyla',
      languageModel: {} as never,
      instructions: 'test',
      tools,
    })
    const installed = (agent as unknown as {
      options: {
        tools: Record<
          string,
          { execute?: (this: unknown, input: unknown, options?: { toolCallId?: string }) => unknown | Promise<unknown> }
        >
      }
    }).options.tools.search

    await observe.run({ name: 'chat', rootPrimitive: 'agent.run' }, async () => {
      await installed?.execute?.call({ ctx: {} }, { query: 'crux' }, { toolCallId: 'call_search' })
    })
    await observe.flush()

    const toolStarts = transport.records.filter(
      (record) => record.type === 'span:start' && record.primitive === 'tool.call' && record.name === 'search',
    )
    expect(toolStarts).toHaveLength(1)
  })

  it('throws for non-Crux tool shapes', () => {
    expect(() => convexTools({ invalid: { description: 'no execute' } })).toThrow(/expected a Crux ToolDef/)
  })

  it('accepts already-authored Convex Agent tools', () => {
    const direct = createTool({
      description: 'Direct Convex Agent tool.',
      inputSchema: z.object({}),
      execute: async () => 'ok',
    })

    const tools = convexTools({ direct })

    expect(tools.direct).toBe(direct)
  })

  it('wraps direct Convex tools with human tool names', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const flushSpy = vi.spyOn(observe, 'flush')

    const execute = vi.fn(async () => 'ok')
    const tool = wrapConvexTool(
      createTool({
        description: 'Research.',
        inputSchema: z.object({}),
        execute,
      }),
      { name: 'research' },
    )

    await observe.run({ name: 'chat', rootPrimitive: 'agent.run' }, async () => {
      await tool.execute?.call({ ctx: { threadId: 'thread-1' } }, {}, { toolCallId: 'call_123' } as any)
    })
    await observe.flush()

    const span = transport.records.find((record) => record.type === 'span:start' && record.primitive === 'tool.call')
    expect(span).toMatchObject({
      name: 'research',
      family: 'tool',
      primitive: 'tool.call',
      attributes: {
        toolName: 'research',
        toolCallId: 'call_123',
      },
    })
    expect(flushSpy).toHaveBeenCalled()
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:end',
        spanId: span?.type === 'span:start' ? span.spanId : undefined,
        status: 'ok',
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'tool.args',
        attributes: expect.objectContaining({ toolName: 'research', toolCallId: 'call_123' }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'tool.result',
        attributes: expect.objectContaining({ toolName: 'research', toolCallId: 'call_123' }),
      }),
    )
  })

  it('records wrapped direct Convex tool execution errors with tool metadata', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const execute = vi.fn(async (): Promise<string> => {
      const error = new Error('direct convex boom')
      error.stack = 'Error: direct convex boom\n    at direct convex tool'
      throw error
    })
    const tool = wrapConvexTool(
      createTool({
        description: 'Research.',
        inputSchema: z.object({}),
        execute,
      }),
      { name: 'research' },
    )

    await expect(
      observe.run({ name: 'chat', rootPrimitive: 'agent.run' }, async () => {
        await tool.execute?.call({ ctx: {} }, {}, { toolCallId: 'call_direct', messages: [] })
      }),
    ).rejects.toThrow('direct convex boom')
    await observe.flush()

    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:event',
        name: 'exception',
        attributes: expect.objectContaining({
          toolName: 'research',
          toolCallId: 'call_direct',
          phase: 'tool.execute',
          errorKind: 'execute_error',
          'error.phase': 'tool.execute',
          'error.kind': 'execute_error',
          'exception.message': 'direct convex boom',
        }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'error.raw',
        attributes: expect.objectContaining({ toolName: 'research', toolCallId: 'call_direct' }),
        preview: expect.objectContaining({ message: 'direct convex boom', name: 'Error' }),
      }),
    )
  })

  it('uses the tools object key instead of the description for Crux createTool spans', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const tool = createCruxTool({
      description: 'CALL THIS TOOL with a long instruction that should never become the trace label.',
      inputSchema: z.object({}),
      execute: async () => 'ok',
    })
    const tools = { askUserQuestion: tool }
    const agent = new Agent({} as any, {
      name: 'Karyla',
      languageModel: {} as any,
      instructions: 'test',
      tools,
    })

    const wrapped = (agent as any).options.tools.askUserQuestion
    await observe.run({ name: 'chat', rootPrimitive: 'agent.run' }, async () => {
      await wrapped.execute?.call({ ctx: {} }, {}, { toolCallId: 'call_question' })
    })
    await observe.flush()

    const span = transport.records.find((record) => record.type === 'span:start' && record.primitive === 'tool.call')
    expect(span).toMatchObject({
      name: 'askUserQuestion',
      attributes: {
        toolName: 'askUserQuestion',
        toolCallId: 'call_question',
      },
    })
  })

  it('provides Crux helpers to direct Convex tool handlers', async () => {
    const ctx = {
      runAction: vi.fn(async (_ref: unknown, args: Record<string, unknown>) => args),
    }
    const execute = vi.fn(async (toolCtx) => {
      const cruxCtx = toolCtx as typeof ctx & { crux: CruxConvexContext }
      expect(cruxCtx.crux).toMatchObject({
        capture: expect.any(Function),
        runAction: expect.any(Function),
      })
      return await cruxCtx.crux.runAction('research', 'internal.agent.research', { query: 'crux' })
    })
    const tool = wrapConvexTool(
      createTool({
        description: 'Research.',
        inputSchema: z.object({}),
        execute,
      }),
      { name: 'research' },
    )

    const result = await observe.run({ name: 'chat', rootPrimitive: 'agent.run' }, async () => {
      return await tool.execute?.call({ ctx }, {}, { toolCallId: 'call_123' } as any)
    })

    expect(result).toMatchObject({
      query: 'crux',
      __crux: expect.objectContaining({
        v: 1,
        observability: expect.any(Object),
      }),
    })
    expect(ctx.runAction).toHaveBeenCalledWith(
      'internal.agent.research',
      expect.objectContaining({
        query: 'crux',
        __crux: expect.any(Object),
      }),
    )
  })

  it('creates Convex Agent tools with Crux tool spans by default', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const flushSpy = vi.spyOn(observe, 'flush')

    const execute = vi.fn(async () => 'ok')
    const tool = createCruxTool({
      title: 'search',
      description: 'Search.',
      inputSchema: z.object({ query: z.string() }),
      execute,
    })

    await observe.run({ name: 'chat', rootPrimitive: 'agent.run' }, async () => {
      await tool.execute?.call({ ctx: {} }, { query: 'crux' }, { toolCallId: 'call_search' } as any)
    })
    await observe.flush()

    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:start',
        name: 'search',
        primitive: 'tool.call',
        attributes: expect.objectContaining({
          toolName: 'search',
          toolCallId: 'call_search',
        }),
      }),
    )
    expect(flushSpy).toHaveBeenCalled()
  })

  it('wraps tools passed to the Crux-aware Convex Agent constructor', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const execute = vi.fn(async () => 'ok')
    const agent = new Agent({} as any, {
      name: 'Karyla',
      languageModel: {} as any,
      tools: {
        research: createTool({
          description: 'Research.',
          inputSchema: z.object({ query: z.string() }),
          execute,
        }),
      },
    })

    await observe.run({ name: 'chat', rootPrimitive: 'agent.run' }, async () => {
      await agent.options.tools?.research.execute?.call({ ctx: {} }, { query: 'crux' }, {
        toolCallId: 'call_agent',
      } as any)
    })
    await observe.flush()

    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:start',
        name: 'research',
        primitive: 'tool.call',
      }),
    )
  })

  it('wraps Convex Agent thread streamText calls in generation spans', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const streamText = vi.spyOn(ConvexAgentBase.prototype, 'streamText').mockImplementation(async function (
      _ctx: unknown,
      _threadOpts: unknown,
      streamArgs: { onFinish?: (result: unknown) => Promise<void> | void },
    ) {
      await streamArgs.onFinish?.({ usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 }, cost: 0.012 })
      return { usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 }, cost: 0.012 } as never
    } as never)
    const agent = new Agent({} as any, {
      name: 'Karyla',
      languageModel: {} as any,
      tools: {},
    })

    await observe.run({ name: 'chat', rootPrimitive: 'agent.run' }, async () => {
      const { thread } = await agent.continueThread({} as any, { threadId: 'thread-1', userId: 'user-1' })
      await thread.streamText({} as any, { saveStreamDeltas: true } as any)
    })
    await observe.flush()

    expect(streamText).toHaveBeenCalled()
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:start',
        name: 'stream response',
        family: 'generation',
        primitive: 'generation.stream',
        attributes: expect.objectContaining({
          agentName: 'Karyla',
          output: 'text',
          source: 'convex.agent',
          threadId: 'thread-1',
          userId: 'user-1',
        }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:event',
        name: 'usage.observed',
        attributes: expect.objectContaining({
          inputTokens: 11,
          outputTokens: 7,
          totalTokens: 18,
          costUsd: 0.012,
        }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:end',
        spanId: (
          transport.records.find(
            (record) => record.type === 'span:start' && record.primitive === 'generation.stream',
          ) as { spanId?: string }
        ).spanId,
        status: 'ok',
      }),
    )
  })

  it('keeps stream args shared so context handlers can inject resolved prompt state', async () => {
    let forwardedSystem: unknown
    let forwardedTools: unknown
    vi.spyOn(ConvexAgentBase.prototype, 'streamText').mockImplementation(async function (
      _ctx: unknown,
      _threadOpts: unknown,
      streamArgs: Record<string, unknown>,
      options: {
        contextHandler?: (
          ctx: unknown,
          args: {
            allMessages: readonly unknown[]
            search: readonly unknown[]
            recent: readonly unknown[]
            inputMessages: readonly unknown[]
            inputPrompt: readonly unknown[]
            existingResponses: readonly unknown[]
            userId?: string
            threadId?: string
          },
        ) => Promise<readonly unknown[]> | readonly unknown[]
      },
    ) {
      await options.contextHandler?.(
        {},
        {
          allMessages: [],
          search: [],
          recent: [],
          inputMessages: [],
          inputPrompt: [],
          existingResponses: [],
          userId: 'user-1',
          threadId: 'thread-1',
        },
      )
      forwardedSystem = streamArgs.system
      forwardedTools = streamArgs.tools
      return {} as never
    } as never)
    const agent = new Agent({} as never, {
      name: 'Karyla',
      languageModel: {} as never,
      tools: {},
    })
    const callArgs: Record<string, unknown> = {}
    const resolvedTools = { lookup: { description: 'Lookup.' } }

    const { thread } = await agent.continueThread({} as never, { threadId: 'thread-1', userId: 'user-1' })
    await thread.streamText(callArgs as never, {
      contextHandler: async () => {
        callArgs.system = 'Resolved Crux system.'
        callArgs.tools = resolvedTools
        return []
      },
    } as never)

    expect(forwardedSystem).toBe('Resolved Crux system.')
    expect(forwardedTools).toBe(resolvedTools)
  })

  it('records interactive Convex Agent tool-call parts when no execute span fires', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    vi.spyOn(ConvexAgentBase.prototype, 'streamText').mockImplementation(async function (
      _ctx: unknown,
      _threadOpts: unknown,
      streamArgs: {
        onStepFinish?: (step: unknown) => Promise<void> | void
        onFinish?: (result: unknown) => Promise<void> | void
      },
    ) {
      await streamArgs.onStepFinish?.({
        toolCalls: [{ toolCallId: 'call_question_fallback', toolName: 'askUserQuestion', input: { questions: [] } }],
      })
      await streamArgs.onFinish?.({})
      return {} as never
    } as never)
    const agent = new Agent({} as any, {
      name: 'Karyla',
      languageModel: {} as any,
      tools: {},
    })

    await observe.run({ name: 'chat', rootPrimitive: 'agent.run' }, async () => {
      const { thread } = await agent.continueThread({} as any, { threadId: 'thread-1', userId: 'user-1' })
      await thread.streamText({} as any, { saveStreamDeltas: true } as any)
    })
    await observe.flush()

    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:start',
        name: 'askUserQuestion',
        primitive: 'tool.call',
        attributes: expect.objectContaining({
          toolName: 'askUserQuestion',
          toolCallId: 'call_question_fallback',
          source: 'convex.agent.step',
          executed: false,
        }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'tool.request',
        attributes: expect.objectContaining({
          toolName: 'askUserQuestion',
          toolCallId: 'call_question_fallback',
        }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'tool.args',
        attributes: expect.objectContaining({
          toolName: 'askUserQuestion',
          toolCallId: 'call_question_fallback',
        }),
      }),
    )
  })

  it('does not create fallback execution spans for normal tool requests before the handler runs', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    vi.spyOn(ConvexAgentBase.prototype, 'streamText').mockImplementation(async function (
      _ctx: unknown,
      _threadOpts: unknown,
      streamArgs: {
        onStepFinish?: (step: unknown) => Promise<void> | void
      },
    ) {
      await streamArgs.onStepFinish?.({
        finishReason: 'tool-calls',
        toolCalls: [{ toolCallId: 'call_research_request', toolName: 'research', input: { queries: ['crux'] } }],
      })
      return {} as never
    } as never)
    const agent = new Agent({} as never, {
      name: 'Karyla',
      languageModel: {} as never,
      tools: {},
    })

    await observe.run({ name: 'chat', rootPrimitive: 'agent.run' }, async () => {
      const { thread } = await agent.continueThread({} as never, { threadId: 'thread-1', userId: 'user-1' })
      await thread.streamText({} as never, { saveStreamDeltas: true } as never)
    })
    await observe.flush()

    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'tool.request',
        attributes: expect.objectContaining({
          toolName: 'research',
          toolCallId: 'call_research_request',
        }),
      }),
    )
    expect(
      transport.records.filter(
        (record) =>
          record.type === 'span:start' &&
          record.primitive === 'tool.call' &&
          record.name === 'research' &&
          record.attributes?.source === 'convex.agent.step',
      ),
    ).toHaveLength(0)
  })

  it('opens stream step spans from prepareStep before the model step finishes', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    let releaseStep: (() => void) | undefined
    const stepGate = new Promise<void>((resolve) => {
      releaseStep = resolve
    })
    vi.spyOn(ConvexAgentBase.prototype, 'streamText').mockImplementation(async function (
      _ctx: unknown,
      _threadOpts: unknown,
      streamArgs: {
        prepareStep?: (options: unknown) => Promise<unknown> | unknown
        onStepFinish?: (step: unknown) => Promise<void> | void
      },
    ) {
      await streamArgs.prepareStep?.({ stepNumber: 0 })
      await stepGate
      await streamArgs.onStepFinish?.({
        stepNumber: 0,
        finishReason: 'stop',
        usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8 },
      })
      return {} as never
    } as never)
    const agent = new Agent({} as never, {
      name: 'Karyla',
      languageModel: {} as never,
      tools: {},
    })

    const streamPromise = observe.run({ name: 'chat', rootPrimitive: 'agent.run' }, async () => {
      const { thread } = await agent.continueThread({} as never, { threadId: 'thread-1', userId: 'user-1' })
      await thread.streamText({} as never, { saveStreamDeltas: true } as never)
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    const stepStart = transport.records.find(
      (record) => record.type === 'span:start' && record.primitive === 'generation.call',
    )
    expect(stepStart).toMatchObject({
      name: 'step 1',
      attributes: expect.objectContaining({
        source: 'convex.agent.step',
        stepNumber: 0,
      }),
    })
    expect(
      transport.records.filter(
        (record) =>
          record.type === 'span:end' &&
          record.spanId === (stepStart?.type === 'span:start' ? stepStart.spanId : undefined),
      ),
    ).toHaveLength(0)

    releaseStep?.()
    await streamPromise
    await observe.flush()

    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:end',
        spanId: stepStart?.type === 'span:start' ? stepStart.spanId : undefined,
        status: 'ok',
        metrics: expect.objectContaining({ totalTokens: 8 }),
      }),
    )
  })

  it('records Convex Agent step lifecycle without closing the stream span early', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    vi.spyOn(ConvexAgentBase.prototype, 'streamText').mockImplementation(async function (
      _ctx: unknown,
      _threadOpts: unknown,
      streamArgs: {
        onStepFinish?: (step: unknown) => Promise<void> | void
      },
    ) {
      await streamArgs.onStepFinish?.({
        finishReason: 'stop',
        usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8 },
      })
      return await new Promise(() => undefined)
    } as never)
    const agent = new Agent({} as any, {
      name: 'Karyla',
      languageModel: {} as any,
      tools: {},
    })

    await observe.run({ name: 'chat', rootPrimitive: 'agent.run' }, async () => {
      const { thread } = await agent.continueThread({} as any, { threadId: 'thread-1', userId: 'user-1' })
      void thread.streamText({} as any, { saveStreamDeltas: true } as any)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    await observe.flush()

    const generationStart = transport.records.find(
      (record) => record.type === 'span:start' && record.primitive === 'generation.stream',
    )
    const stepStart = transport.records.find(
      (record) => record.type === 'span:start' && record.primitive === 'generation.call',
    )
    expect(generationStart).toBeDefined()
    expect(stepStart).toMatchObject({
      parentSpanId: generationStart?.type === 'span:start' ? generationStart.spanId : undefined,
      attributes: expect.objectContaining({ finishReason: 'stop' }),
    })
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:event',
        spanId: stepStart?.type === 'span:start' ? stepStart.spanId : undefined,
        name: 'generation.step',
        attributes: expect.objectContaining({
          finishReason: 'stop',
        }),
      }),
    )
    expect(
      transport.records.filter(
        (record) =>
          record.type === 'span:end' &&
          record.spanId === (generationStart?.type === 'span:start' ? generationStart.spanId : undefined),
      ),
    ).toHaveLength(0)
  })

  it('records stop-condition tool calls without closing the stream span early', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    vi.spyOn(ConvexAgentBase.prototype, 'streamText').mockImplementation(async function (
      _ctx: unknown,
      _threadOpts: unknown,
      streamArgs: {
        onStepFinish?: (step: unknown) => Promise<void> | void
      },
    ) {
      await streamArgs.onStepFinish?.({
        finishReason: 'tool-calls',
        toolCalls: [{ toolCallId: 'call_question_lifecycle', toolName: 'askUserQuestion', input: { questions: [] } }],
      })
      return await new Promise(() => undefined)
    } as never)
    const agent = new Agent({} as any, {
      name: 'Karyla',
      languageModel: {} as any,
      tools: {},
    })

    await observe.run({ name: 'chat', rootPrimitive: 'agent.run' }, async () => {
      const { thread } = await agent.continueThread({} as any, { threadId: 'thread-1', userId: 'user-1' })
      void thread.streamText({} as any, { saveStreamDeltas: true } as any)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    await observe.flush()

    const generationStart = transport.records.find(
      (record) => record.type === 'span:start' && record.primitive === 'generation.stream',
    )
    const stepStart = transport.records.find(
      (record) => record.type === 'span:start' && record.primitive === 'generation.call',
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:start',
        name: 'askUserQuestion',
        primitive: 'tool.call',
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:event',
        spanId: stepStart?.type === 'span:start' ? stepStart.spanId : undefined,
        name: 'generation.step',
        attributes: expect.objectContaining({
          finishReason: 'tool-calls',
          stopConditionTool: 'askUserQuestion',
        }),
      }),
    )
    expect(
      transport.records.filter(
        (record) =>
          record.type === 'span:end' &&
          record.spanId === (generationStart?.type === 'span:start' ? generationStart.spanId : undefined),
      ),
    ).toHaveLength(0)
  })

  it('records non-terminal tool-call steps without closing the stream span early', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    vi.spyOn(ConvexAgentBase.prototype, 'streamText').mockImplementation(async function (
      _ctx: unknown,
      _threadOpts: unknown,
      streamArgs: {
        onStepFinish?: (step: unknown) => Promise<void> | void
      },
    ) {
      await streamArgs.onStepFinish?.({
        finishReason: 'tool-calls',
        toolCalls: [{ toolCallId: 'call_writer_step', toolName: 'writer', input: { instruction: 'edit' } }],
      })
      return await new Promise(() => undefined)
    } as never)
    const agent = new Agent({} as any, {
      name: 'Karyla',
      languageModel: {} as any,
      tools: {},
    })

    await observe.run({ name: 'chat', rootPrimitive: 'agent.run' }, async () => {
      const { thread } = await agent.continueThread({} as any, { threadId: 'thread-1', userId: 'user-1' })
      void thread.streamText({} as any, { saveStreamDeltas: true } as any)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    await observe.flush()

    const generationStart = transport.records.find(
      (record) => record.type === 'span:start' && record.primitive === 'generation.stream',
    )
    const stepStart = transport.records.find(
      (record) => record.type === 'span:start' && record.primitive === 'generation.call',
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:event',
        spanId: stepStart?.type === 'span:start' ? stepStart.spanId : undefined,
        name: 'generation.step',
        attributes: expect.objectContaining({
          finishReason: 'tool-calls',
        }),
      }),
    )
    expect(
      transport.records.filter(
        (record) =>
          record.type === 'span:end' &&
          record.spanId === (generationStart?.type === 'span:start' ? generationStart.spanId : undefined),
      ),
    ).toHaveLength(0)
  })

  it('closes Convex Agent stream spans on stream completion after tool-call steps', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    vi.spyOn(ConvexAgentBase.prototype, 'streamText').mockImplementation(async function (
      _ctx: unknown,
      _threadOpts: unknown,
      streamArgs: {
        onStepFinish?: (step: unknown) => Promise<void> | void
        onFinish?: (result: unknown) => Promise<void> | void
      },
    ) {
      await streamArgs.onStepFinish?.({
        finishReason: 'tool-calls',
        toolCalls: [{ toolCallId: 'call_writer_complete', toolName: 'writer', input: { instruction: 'edit' } }],
      })
      await streamArgs.onFinish?.({ usage: { inputTokens: 9, outputTokens: 4, totalTokens: 13 } })
      return { usage: { inputTokens: 9, outputTokens: 4, totalTokens: 13 } } as never
    } as never)
    const agent = new Agent({} as any, {
      name: 'Karyla',
      languageModel: {} as any,
      tools: {},
    })

    await observe.run({ name: 'chat', rootPrimitive: 'agent.run' }, async () => {
      const { thread } = await agent.continueThread({} as any, { threadId: 'thread-1', userId: 'user-1' })
      await thread.streamText({} as any, { saveStreamDeltas: true } as any)
    })
    await observe.flush()

    const generationStart = transport.records.find(
      (record) => record.type === 'span:start' && record.primitive === 'generation.stream',
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:end',
        spanId: generationStart?.type === 'span:start' ? generationStart.spanId : undefined,
        status: 'ok',
        attributes: expect.objectContaining({
          finish: 'stream',
        }),
      }),
    )
  })

  it('records consecutive Convex Agent LLM steps as inspectable generation spans', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    vi.spyOn(ConvexAgentBase.prototype, 'streamText').mockImplementation(async function (
      _ctx: unknown,
      _threadOpts: unknown,
      streamArgs: {
        onStepFinish?: (step: unknown) => Promise<void> | void
        onFinish?: (result: unknown) => Promise<void> | void
      },
    ) {
      await streamArgs.onStepFinish?.({
        stepNumber: 0,
        text: 'I will inspect the draft.',
        content: [{ type: 'text', text: 'I will inspect the draft.' }],
        finishReason: 'tool-calls',
        usage: { inputTokens: 7, outputTokens: 5, totalTokens: 12 },
        toolCalls: [{ toolCallId: 'call_writer_multistep', toolName: 'writer', input: { instruction: 'edit' } }],
      })
      await streamArgs.onStepFinish?.({
        stepNumber: 1,
        text: 'The plan is ready for review.',
        content: [{ type: 'text', text: 'The plan is ready for review.' }],
        finishReason: 'stop',
        usage: { inputTokens: 11, outputTokens: 8, totalTokens: 19 },
        cost: 0.02,
      })
      await streamArgs.onFinish?.({ totalUsage: { inputTokens: 18, outputTokens: 13, totalTokens: 31 } })
      return { totalUsage: { inputTokens: 18, outputTokens: 13, totalTokens: 31 } } as never
    } as never)
    const agent = new Agent({} as any, {
      name: 'Karyla',
      languageModel: {} as any,
      tools: {},
    })

    await observe.run({ name: 'chat', rootPrimitive: 'agent.run' }, async () => {
      const { thread } = await agent.continueThread({} as any, { threadId: 'thread-1', userId: 'user-1' })
      await thread.streamText({} as any, { saveStreamDeltas: true } as any)
    })
    await observe.flush()

    const streamStart = transport.records.find(
      (record) => record.type === 'span:start' && record.primitive === 'generation.stream',
    )
    const stepStarts = transport.records.filter(
      (record) => record.type === 'span:start' && record.primitive === 'generation.call',
    )
    expect(stepStarts).toHaveLength(2)
    expect(stepStarts).toContainEqual(
      expect.objectContaining({
        parentSpanId: streamStart?.type === 'span:start' ? streamStart.spanId : undefined,
        attributes: expect.objectContaining({ source: 'convex.agent.step', stepNumber: 0, finishReason: 'tool-calls' }),
      }),
    )
    expect(stepStarts).toContainEqual(
      expect.objectContaining({
        parentSpanId: streamStart?.type === 'span:start' ? streamStart.spanId : undefined,
        attributes: expect.objectContaining({ source: 'convex.agent.step', stepNumber: 1, finishReason: 'stop' }),
      }),
    )
    const firstStepId = stepStarts[0]?.type === 'span:start' ? stepStarts[0].spanId : undefined
    const secondStepId = stepStarts[1]?.type === 'span:start' ? stepStarts[1].spanId : undefined
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        spanId: firstStepId,
        kind: 'tool.request',
        attributes: expect.objectContaining({ toolCallId: 'call_writer_multistep', toolName: 'writer' }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        spanId: secondStepId,
        kind: 'output',
        preview: 'The plan is ready for review.',
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:end',
        spanId: secondStepId,
        status: 'ok',
        metrics: expect.objectContaining({ totalTokens: 19, costUsd: 0.02 }),
      }),
    )
  })

  it('records only materialized stop-condition tool calls from returned Convex Agent stream results', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    vi.spyOn(ConvexAgentBase.prototype, 'streamText').mockImplementation(async function () {
      return {
        toolCalls: [
          {
            toolCallId: 'call_question_materialized',
            toolName: 'askUserQuestion',
            input: { questions: [{ id: 'tone', question: 'Tone?', options: [] }] },
          },
        ],
      } as never
    } as never)
    const agent = new Agent({} as any, {
      name: 'Karyla',
      languageModel: {} as any,
      tools: {},
    })

    await observe.run({ name: 'chat', rootPrimitive: 'agent.run' }, async () => {
      const { thread } = await agent.continueThread({} as any, { threadId: 'thread-1', userId: 'user-1' })
      await thread.streamText({} as any, { saveStreamDeltas: true } as any)
    })
    await observe.flush()

    const toolStart = transport.records.find(
      (record) => record.type === 'span:start' && record.primitive === 'tool.call',
    )
    const generationStart = transport.records.find(
      (record) => record.type === 'span:start' && record.primitive === 'generation.stream',
    )
    expect(toolStart).toMatchObject({
      name: 'askUserQuestion',
      parentSpanId: generationStart?.type === 'span:start' ? generationStart.spanId : undefined,
      attributes: expect.objectContaining({
        toolName: 'askUserQuestion',
        toolCallId: 'call_question_materialized',
        source: 'convex.agent.step',
        executed: false,
        stopCondition: true,
      }),
    })
    expect(
      transport.records.filter((record) => record.type === 'span:start' && record.primitive === 'tool.call'),
    ).toHaveLength(1)
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:end',
        spanId: generationStart?.type === 'span:start' ? generationStart.spanId : undefined,
        status: 'ok',
      }),
    )
  })

  it('ends Convex Agent stream spans even when returned metadata promises never settle', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    vi.spyOn(ConvexAgentBase.prototype, 'streamText').mockImplementation(async function () {
      return {
        usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
        toolCalls: new Promise(() => undefined),
        finalStep: new Promise(() => undefined),
      } as never
    } as never)
    const agent = new Agent({} as any, {
      name: 'Karyla',
      languageModel: {} as any,
      tools: {},
    })

    await observe.run({ name: 'chat', rootPrimitive: 'agent.run' }, async () => {
      const { thread } = await agent.continueThread({} as any, { threadId: 'thread-1', userId: 'user-1' })
      await thread.streamText({} as any, { saveStreamDeltas: true } as any)
    })
    await observe.flush()

    const generationStart = transport.records.find(
      (record) => record.type === 'span:start' && record.primitive === 'generation.stream',
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:end',
        spanId: generationStart?.type === 'span:start' ? generationStart.spanId : undefined,
        status: 'ok',
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'run:end',
        status: 'ok',
      }),
    )
  })

  it('does not await or emit from promise-valued Convex Agent stream metadata', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    vi.spyOn(ConvexAgentBase.prototype, 'streamText').mockImplementation(async function () {
      return {
        toolCalls: new Promise((resolve) => {
          setTimeout(
            () =>
              resolve([
                {
                  toolCallId: 'call_late_question',
                  toolName: 'askUserQuestion',
                },
              ]),
            350,
          )
        }),
      } as never
    } as never)
    const agent = new Agent({} as any, {
      name: 'Karyla',
      languageModel: {} as any,
      tools: {},
    })

    await observe.run({ name: 'chat', rootPrimitive: 'agent.run' }, async () => {
      const { thread } = await agent.continueThread({} as any, { threadId: 'thread-1', userId: 'user-1' })
      await thread.streamText({} as any, { saveStreamDeltas: true } as any)
    })
    await observe.flush()
    await new Promise((resolve) => setTimeout(resolve, 400))
    await observe.flush()

    expect(
      transport.records.filter(
        (record) =>
          record.type === 'span:start' && record.primitive === 'tool.call' && record.name === 'askUserQuestion',
      ),
    ).toHaveLength(0)
  })

  it('creates a Crux-aware Convex Agent from a Crux prompt definition', async () => {
    const execute = vi.fn(async () => 'done')
    const prompt = {
      id: 'support-prompt',
      resolve: vi.fn(async () => ({ system: 'Resolved support instructions.' })),
      inspect: vi.fn(async () => ({ tools: [] })),
      tools: {
        lookup: {
          description: 'Lookup.',
          parameters: z.object({ id: z.string() }),
          execute,
        },
      },
    }
    const model = { modelId: 'test-model' }

    const agent = await createAgent({} as any, prompt as any, {
      name: 'Support',
      model: model as any,
      input: { locale: 'en' },
    })

    expect(agent).toBeInstanceOf(Agent)
    expect(prompt.resolve).toHaveBeenCalledWith({ input: { locale: 'en' }, tokenBudget: undefined })
    expect(agent.options.name).toBe('Support')
    expect(agent.options.instructions).toBe('Resolved support instructions.')
    expect(agent.options.languageModel).toBe(model)
    expect(agent.options.tools).toHaveProperty('lookup')
  })
})
