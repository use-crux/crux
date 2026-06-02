import { Agent as ConvexAgentBase } from '@convex-dev/agent'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import { prompt } from '../index'
import { convexAgent } from '../agent'
import { inMemoryCruxStore, memory, memoryBlock, recentMessages } from '../memory'
import { runWithConvexCruxRuntime } from '../runtime'
import { context } from '../context'
import { tool } from '../tools'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
  type CruxGraphRecord,
} from '@crux/core/observability'

describe('Convex profile runtime', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    resetObservabilityRuntime()
  })

  it('late-binds memory store and default thread namespace from the active runtime', async () => {
    const store = inMemoryCruxStore()
    const runtimeMemory = memory({
      id: 'runtime-memory',
      blocks: [
        memoryBlock({
          id: 'namespace',
          render: ({ namespace }) => `namespace=${namespace}`,
        }),
      ],
    })

    const rendered = await runWithConvexCruxRuntime(
      {
        ctx: {},
        store,
        target: { threadId: 'thread-1' },
      },
      () => runtimeMemory.asContext().systemFn({}),
    )

    expect(rendered).toContain('namespace=thread:thread-1')
  })

  it('passes Convex runtime context into Convex-profile tools', async () => {
    const runtimeTool = tool({
      name: 'runtimeTool',
      description: 'Read runtime metadata.',
      input: z.object({
        value: z.string(),
      }),
      execute: ({ input, ctx, target }) => {
        return {
          value: input.value,
          ctxKind: typeof ctx,
          threadId: target.threadId,
        }
      },
    })

    const result = await runWithConvexCruxRuntime(
      {
        ctx: { marker: true },
        store: inMemoryCruxStore(),
        target: { threadId: 'thread-2' },
      },
      () => runtimeTool.execute({ value: 'ok' }),
    )

    expect(result).toEqual({
      value: 'ok',
      ctxKind: 'object',
      threadId: 'thread-2',
    })
  })

  it('keeps interleaved Convex runtime targets isolated across awaits', async () => {
    const runtimeTool = tool({
      name: 'runtimeIsolationTool',
      description: 'Read target after async work.',
      input: z.object({
        label: z.string(),
      }),
      execute: async ({ input, target }) => {
        await Promise.resolve()
        return `${input.label}:${target.threadId ?? 'missing'}`
      },
    })

    const [first, second] = await Promise.all([
      runWithConvexCruxRuntime(
        {
          ctx: { label: 'first' },
          store: inMemoryCruxStore(),
          target: { threadId: 'thread-first' },
        },
        () => runtimeTool.execute({ label: 'first' }),
      ),
      runWithConvexCruxRuntime(
        {
          ctx: { label: 'second' },
          store: inMemoryCruxStore(),
          target: { threadId: 'thread-second' },
        },
        () => runtimeTool.execute({ label: 'second' }),
      ),
    ])

    expect(first).toBe('first:thread-first')
    expect(second).toBe('second:thread-second')
  })

  it('composes prepare runtime use entries with prompt overrides', async () => {
    const extraContext = context({
      id: 'extra-context',
      input: z.object({
        suffix: z.string(),
      }),
      system: ({ input }) => `suffix=${input.suffix}`,
    })

    const basePrompt = prompt({
      id: 'base-agent',
      input: z.object({
        message: z.string(),
        suffix: z.string(),
      }),
      system: 'base',
      prompt: ({ input }) => input.message,
    })

    const overridePrompt = prompt({
      id: 'override-agent',
      input: z.object({
        message: z.string(),
        suffix: z.string(),
      }),
      system: 'override',
      prompt: ({ input }) => input.message,
    })

    const agent = convexAgent({
      components: {
        crux: { marker: 'crux' } as never,
        agent: { marker: 'agent' } as never,
      },
      prompt: basePrompt,
      model: {} as LanguageModelV3,
      store: () => inMemoryCruxStore(),
      prepare: ({ input }) => ({
        prompt: overridePrompt,
        input,
        use: [extraContext],
      }),
    })

    const resolved = await agent.resolve(
      {},
      { threadId: 'thread-3' },
      {
        input: {
          message: 'hello',
          suffix: 'prepared',
        },
      },
    )

    expect(resolved.system).toContain('override')
    expect(resolved.system).toContain('suffix=prepared')
  })

  it('accepts mixed Crux ToolDefs and prebuilt Convex Agent tools as extra agent tools', async () => {
    const basePrompt = prompt({
      id: 'mixed-tools-agent',
      input: z.object({
        message: z.string(),
      }),
      prompt: ({ input }) => input.message,
    })

    const cruxStyleTool = tool({
      name: 'cruxStyleTool',
      description: 'Crux style tool.',
      input: z.object({
        value: z.string(),
      }),
      execute: ({ input }) => input.value,
    })

    const existingConvexTool = {
      description: 'Already converted Convex Agent tool.',
      execute: () => 'ok',
    }

    const agent = convexAgent({
      components: {
        crux: { marker: 'crux' } as never,
        agent: { marker: 'agent' } as never,
      },
      prompt: basePrompt,
      model: {} as LanguageModelV3,
      store: () => inMemoryCruxStore(),
      tools: {
        cruxStyleTool,
        existingConvexTool,
      },
    })

    await expect(
      agent.resolve(
        {},
        { threadId: 'thread-4' },
        {
          input: {
            message: 'hello',
          },
        },
      ),
    ).resolves.toBeDefined()
  })

  it('prepares threaded calls with the current prompt before invoking Convex Agent', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const agentComponent = {
      messages: {
        listMessagesByThreadId: 'messages:listByThread',
      },
      threads: {
        getThread: 'threads:get',
      },
    }
    const currentPromptText = 'Go and factcheck our post'
    const promptMessage = {
      _id: 'message-1',
      _creationTime: 1,
      userId: 'user-1',
      threadId: 'thread-5',
      order: 1,
      stepOrder: 0,
      status: 'success',
      tool: false,
      text: currentPromptText,
      message: {
        role: 'user',
        content: currentPromptText,
      },
    }
    const ctx = {
      runQuery: vi.fn(async (ref: unknown) => {
        if (ref === agentComponent.messages.listMessagesByThreadId) {
          return { page: [promptMessage] }
        }
        if (ref === agentComponent.threads.getThread) {
          return { userId: 'user-1' }
        }
        return undefined
      }),
      runMutation: vi.fn(),
      runAction: vi.fn(),
      storage: {},
      auth: {},
    }
    let forwardedArgs: Record<string, unknown> | undefined
    let forwardedOptions: Record<string, unknown> | undefined
    vi.spyOn(ConvexAgentBase.prototype, 'streamText').mockImplementation(async function (
      _ctx: unknown,
      _threadOpts: unknown,
      streamArgs: Record<string, unknown>,
      options?: Record<string, unknown>,
    ) {
      forwardedArgs = streamArgs
      forwardedOptions = options
      return {} as never
    } as never)
    const runtimeLookup = tool({
      name: 'runtimeLookup',
      description: 'Runtime lookup.',
      input: z.object({ query: z.string() }),
      execute: ({ input }) => input.query,
    })
    const currentPromptContext = context({
      id: 'current-prompt',
      input: z.object({
        memoryQuery: z.string(),
      }),
      system: ({ input }) => `current-query=${input.memoryQuery}`,
      tools: {
        runtimeLookup,
      },
    })
    const basePrompt = prompt({
      id: 'threaded-agent',
      input: z.object({
        memoryQuery: z.string().optional(),
      }),
      system: 'base-system',
      prompt: ({ input }) => `prepared:${input.memoryQuery ?? ''}`,
    })
    const agent = convexAgent({
      name: 'Karyla',
      components: {
        crux: { marker: 'crux' } as never,
        agent: agentComponent as never,
      },
      prompt: basePrompt,
      model: {} as LanguageModelV3,
      store: () => inMemoryCruxStore(),
      prepare: ({ input, messages }) => ({
        input: {
          ...input,
          memoryQuery: typeof messages?.inputPrompt[0]?.content === 'string' ? messages.inputPrompt[0].content : '',
        },
        use: [currentPromptContext],
      }),
    })

    const { thread } = await agent.continueThread(
      ctx,
      { threadId: 'thread-5', userId: 'user-1' },
      {
        input: {},
      },
    )
    const stopWhen = Symbol('stopWhen')
    await observe.run({ name: 'chat', rootPrimitive: 'agent.run' }, async () => {
      await thread.streamText(
        {
          promptMessageId: 'message-1',
          stopWhen,
        },
        { saveStreamDeltas: true },
      )
    })
    await observe.flush()

    expect(forwardedArgs?.promptMessageId).toBe('message-1')
    expect(forwardedArgs?.stopWhen).toBe(stopWhen)
    expect(forwardedArgs?.system).toContain('base-system')
    expect(forwardedArgs?.prompt).toBe(`prepared:${currentPromptText}`)
    expect(forwardedArgs?.system).toContain(`current-query=${currentPromptText}`)
    expect(forwardedArgs?.tools).toHaveProperty('runtimeLookup')
    expect(typeof forwardedOptions?.contextHandler).toBe('function')

    const finalMessages = await (
      forwardedOptions?.contextHandler as (
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
      ) => Promise<readonly unknown[]>
    )(
      {},
      {
        allMessages: [{ role: 'user', content: 'second pass should not leak' }],
        search: [],
        recent: [],
        inputMessages: [],
        inputPrompt: [{ role: 'user', content: currentPromptText }],
        existingResponses: [],
        userId: 'user-1',
        threadId: 'thread-5',
      },
    )
    expect(finalMessages).toEqual([{ role: 'user', content: `prepared:${currentPromptText}` }])

    const agentSpan = transport.records.find(
      (record) => record.type === 'span:start' && record.primitive === 'agent.run',
    )
    expect(agentSpan).toMatchObject({
      name: 'Karyla',
      family: 'agent',
      primitive: 'agent.run',
      attributes: expect.objectContaining({
        agentName: 'Karyla',
        operation: 'streamText',
        promptId: 'threaded-agent',
        threadId: 'thread-5',
        userId: 'user-1',
      }),
    })
    const agentEnd = transport.records.find(
      (record) =>
        record.type === 'span:end' &&
        record.spanId === (agentSpan?.type === 'span:start' ? agentSpan.spanId : undefined),
    )
    expect(agentEnd).toMatchObject({
      attributes: expect.objectContaining({
        toolCount: 1,
        toolNames: ['runtimeLookup'],
        contextSources: expect.arrayContaining(['current-prompt']),
      }),
    })

    const toolRegistration = transport.records.find(
      (record) => record.type === 'span:event' && record.name === 'convex.agent.tools.registered',
    )
    expect(toolRegistration).toMatchObject({
      attributes: expect.objectContaining({
        agentName: 'Karyla',
        operation: 'streamText',
        toolCount: 1,
        toolNames: ['runtimeLookup'],
      }),
    })
  })

  it('keeps the thread prompt message when the Crux prompt resolves only system context', async () => {
    const agentComponent = {
      messages: {
        listMessagesByThreadId: Symbol('listMessagesByThreadId'),
      },
      threads: {
        getThread: Symbol('getThread'),
      },
    }
    const promptMessage = {
      _id: 'message-2',
      _creationTime: 1,
      userId: 'user-1',
      threadId: 'thread-6',
      order: 1,
      stepOrder: 0,
      status: 'success',
      tool: false,
      text: 'Go and factcheck our post',
      message: {
        role: 'user',
        content: 'Go and factcheck our post',
      },
    }
    const ctx = {
      runQuery: vi.fn(async (ref: unknown) => {
        if (ref === agentComponent.messages.listMessagesByThreadId) {
          return { page: [promptMessage] }
        }
        if (ref === agentComponent.threads.getThread) {
          return { userId: 'user-1' }
        }
        return undefined
      }),
      runMutation: vi.fn(),
      runAction: vi.fn(),
      storage: {},
      auth: {},
    }
    let forwardedOptions: Record<string, unknown> | undefined
    vi.spyOn(ConvexAgentBase.prototype, 'streamText').mockImplementation(async function (
      _ctx: unknown,
      _threadOpts: unknown,
      _streamArgs: Record<string, unknown>,
      options?: Record<string, unknown>,
    ) {
      forwardedOptions = options
      return {} as never
    } as never)

    const basePrompt = prompt({
      id: 'system-only-agent',
      input: z.object({
        mode: z.string().optional(),
      }),
      system: 'system-only',
    })
    const agent = convexAgent({
      name: 'Karyla',
      components: {
        crux: { marker: 'crux' } as never,
        agent: agentComponent as never,
      },
      prompt: basePrompt,
      model: {} as LanguageModelV3,
      store: () => inMemoryCruxStore(),
    })

    const { thread } = await agent.continueThread(
      ctx,
      { threadId: 'thread-6', userId: 'user-1' },
      {
        input: {
          mode: 'chat',
        },
      },
    )
    await thread.streamText({
      promptMessageId: 'message-2',
    })

    expect(typeof forwardedOptions?.contextHandler).toBe('function')
    const finalMessages = await (
      forwardedOptions?.contextHandler as (
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
      ) => Promise<readonly unknown[]>
    )(
      {},
      {
        allMessages: [{ role: 'user', content: 'stale refetch content' }],
        search: [],
        recent: [],
        inputMessages: [],
        inputPrompt: [{ role: 'user', content: 'stale refetch content' }],
        existingResponses: [],
        userId: 'user-1',
        threadId: 'thread-6',
      },
    )
    expect(finalMessages).toEqual([{ role: 'user', content: 'Go and factcheck our post' }])
  })

  it('flushes the high-level agent terminal span before returning', async () => {
    const delivered: CruxGraphRecord[] = []
    setObservabilityTransport({
      async send(records) {
        await Promise.resolve()
        delivered.push(...records)
      },
    })
    const basePrompt = prompt({
      id: 'flush-agent',
      input: z.object({
        message: z.string(),
      }),
      prompt: ({ input }) => input.message,
    })
    const agent = convexAgent({
      name: 'Flushy',
      components: {
        crux: { marker: 'crux' } as never,
        agent: { marker: 'agent' } as never,
      },
      prompt: basePrompt,
      model: {} as LanguageModelV3,
      store: () => inMemoryCruxStore(),
    })

    await observe.run({ name: 'chat', rootPrimitive: 'agent.run' }, async () => {
      await agent.resolve(
        {},
        { threadId: 'thread-flush' },
        {
          input: {
            message: 'hello',
          },
        },
      )

      const agentStart = delivered.find(
        (record) => record.type === 'span:start' && record.primitive === 'agent.run' && record.name === 'Flushy',
      )
      expect(agentStart).toBeDefined()
      if (!agentStart || agentStart.type !== 'span:start') {
        throw new Error('Expected flushed agent span start.')
      }
      expect(delivered).toContainEqual(
        expect.objectContaining({
          type: 'span:end',
          spanId: agentStart.spanId,
          status: 'ok',
        }),
      )
    })
  })

  it('does not abort the turn when post-turn memory capture fails', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const agentComponent = {
      messages: { listMessagesByThreadId: 'messages:listByThread' },
      threads: { getThread: 'threads:get' },
    }
    const promptText = 'remember this for later'
    const promptMessage = {
      _id: 'message-1',
      _creationTime: 1,
      userId: 'user-1',
      threadId: 'thread-cap',
      order: 1,
      stepOrder: 0,
      status: 'success',
      tool: false,
      text: promptText,
      message: { role: 'user', content: promptText },
    }
    const ctx = {
      runQuery: vi.fn(async (ref: unknown) => {
        if (ref === agentComponent.messages.listMessagesByThreadId) return { page: [promptMessage] }
        if (ref === agentComponent.threads.getThread) return { userId: 'user-1' }
        return undefined
      }),
      runMutation: vi.fn(),
      runAction: vi.fn(),
      storage: {},
      auth: {},
    }

    // A store whose writes always fail forces memory captureTurn to throw,
    // simulating a transient Convex store failure during post-turn persistence.
    const failingStore = {
      ...inMemoryCruxStore(),
      set: async () => {
        throw new Error('store write boom')
      },
    }

    let onFinishCalled = false
    vi.spyOn(ConvexAgentBase.prototype, 'streamText').mockImplementation(async function (
      _ctx: unknown,
      _threadOpts: unknown,
      streamArgs: { onFinish?: (result: unknown) => Promise<void> | void },
    ) {
      // The agent component invokes onFinish once the model stream completes;
      // this is where the high-level wrapper runs best-effort memory capture.
      await streamArgs.onFinish?.({ text: 'assistant reply' })
      onFinishCalled = true
      return {} as never
    } as never)

    const captureMemory = memory({ id: 'capture-mem', blocks: [recentMessages({ id: 'recent' })] })
    const basePrompt = prompt({
      id: 'capture-agent',
      input: z.object({}),
      system: 'base-system',
      prompt: () => promptText,
    })
    const agent = convexAgent({
      name: 'Karyla',
      components: { crux: { marker: 'crux' } as never, agent: agentComponent as never },
      prompt: basePrompt,
      model: {} as LanguageModelV3,
      store: () => failingStore,
      prepare: () => ({ use: [captureMemory] }),
    })

    const { thread } = await agent.continueThread(ctx, { threadId: 'thread-cap', userId: 'user-1' }, { input: {} })

    await observe.run({ name: 'chat', rootPrimitive: 'agent.run' }, async () => {
      // The turn must resolve even though post-turn memory capture throws.
      await expect(
        thread.streamText({ promptMessageId: 'message-1' }, { saveStreamDeltas: true }),
      ).resolves.toBeDefined()
    })
    await observe.flush()

    expect(onFinishCalled).toBe(true)

    // The failure is reported as a contained error span (with errorKind),
    // not propagated as a turn failure. (span:end records carry attributes
    // but not `primitive`, so match on the errorKind attribute.)
    const captureError = transport.records.find(
      (record) =>
        record.type === 'span:end' && record.status === 'error' && record.attributes?.errorKind === 'capture_error',
    )
    expect(captureError).toBeDefined()

    // The surrounding stream span still completes ok — the reply was not aborted.
    const generationStart = transport.records.find(
      (record) => record.type === 'span:start' && record.primitive === 'generation.stream',
    )
    expect(generationStart).toBeDefined()
    const streamEnd =
      generationStart?.type === 'span:start'
        ? transport.records.find(
            (record) =>
              record.type === 'span:end' && record.spanId === generationStart.spanId && record.status === 'ok',
          )
        : undefined
    expect(streamEnd).toBeDefined()
  })
})
