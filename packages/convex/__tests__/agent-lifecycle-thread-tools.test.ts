import type { LanguageModelV3 } from '@ai-sdk/provider'
import { prompt } from '@use-crux/core'
import { resetObservabilityRuntime } from '@use-crux/core/observability'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { context } from '../src/context'
import { createProfileBackedAgentLifecycle } from '../src/agent/lifecycle'
import { inMemoryRecordStore } from '../src/memory'
import { tool } from '../src/tools'
import { FakeConvexAgentDriver } from './fixtures/fakeAgentDriver'

describe('profile-backed Convex Agent thread and tool lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    resetObservabilityRuntime()
  })

  it('continues threads by inspecting Convex Agent context before resolving Crux prompt state', async () => {
    const driver = new FakeConvexAgentDriver()
    driver.contextSnapshot = {
      all: [{ role: 'user', content: 'stale all' }],
      search: [{ role: 'system', content: 'search result' }],
      recent: [{ role: 'assistant', content: 'previous reply' }],
      inputMessages: [],
      inputPrompt: [{ role: 'user', content: 'tighten this paragraph' }],
      existingResponses: [],
      threadId: 'thread-from-context',
      userId: 'user-from-context',
    }
    const model = {} as LanguageModelV3
    const currentTurn = context({
      id: 'current-turn',
      input: z.object({
        currentPrompt: z.string(),
      }),
      system: ({ input }) => `current=${input.currentPrompt}`,
    })
    const basePrompt = prompt({
      id: 'threaded-writer',
      input: z.object({
        currentPrompt: z.string().optional(),
      }),
      system: 'base',
      prompt: ({ input }) => `prepared:${input.currentPrompt ?? ''}`,
    })
    const lifecycle = createProfileBackedAgentLifecycle({
      components: {
        crux: { marker: 'crux' } as never,
        agent: { marker: 'agent' } as never,
      },
      driver,
      model,
      name: 'Threaded Writer',
      prompt: basePrompt,
      storage: () => inMemoryRecordStore(),
      prepare: ({ input, messages }) => ({
        input: {
          ...input,
          currentPrompt: String(messages?.inputPrompt[0]?.content ?? ''),
        },
        use: [currentTurn],
        captureMessages: messages?.recent,
      }),
    })

    const { thread } = await lifecycle.continueThread({
      ctx: { marker: 'ctx' },
      target: { threadId: 'thread-original', userId: 'user-original' },
    } as never)
    const stopWhen = Symbol('stopWhen') as never
    await thread.streamText({ input: {}, promptMessageId: 'message-1', stopWhen }, { saveStreamDeltas: true })

    expect(driver.contextRequests).toEqual([
      expect.objectContaining({
        agentName: 'Threaded Writer',
        target: { threadId: 'thread-original', userId: 'user-original' },
        callArgs: { promptMessageId: 'message-1', stopWhen },
        options: { saveStreamDeltas: true },
      }),
    ])
    expect(driver.streamedTextCalls).toEqual([
      expect.objectContaining({
        target: { threadId: 'thread-from-context', userId: 'user-from-context' },
        args: expect.objectContaining({
          promptMessageId: 'message-1',
          stopWhen,
          prompt: 'prepared:tighten this paragraph',
          system: expect.stringContaining('current=tighten this paragraph'),
        }),
        options: expect.objectContaining({
          saveStreamDeltas: true,
          contextHandler: expect.any(Function),
        }),
      }),
    ])
    const contextHandler = driver.streamedTextCalls[0]?.options?.contextHandler as
      | (() => Promise<readonly unknown[]>)
      | undefined
    expect(driver.streamedTextCalls[0]?.args).not.toHaveProperty('input')
    await expect(contextHandler?.()).resolves.toEqual([
      { role: 'system', content: 'search result' },
      { role: 'assistant', content: 'previous reply' },
      { role: 'user', content: 'prepared:tighten this paragraph' },
    ])
  })

  it('adapts Crux tools once and rebinds toolCallId into Convex runtime metadata', async () => {
    const driver = new FakeConvexAgentDriver()
    const model = {} as LanguageModelV3
    const runtimeLookup = tool({
      name: 'runtimeLookup',
      description: 'Read runtime metadata.',
      input: z.object({ query: z.string() }),
      execute: ({ input, target }) => ({
        query: input.query,
        threadId: target.threadId,
        toolCallId: target.toolCallId,
      }),
    })
    const directTool = {
      description: 'Already a Convex Agent tool.',
      execute: async () => 'direct',
    }
    const basePrompt = prompt({
      id: 'tool-agent',
      input: z.object({ message: z.string() }),
      tools: { runtimeLookup },
      prompt: ({ input }) => input.message,
    })
    const lifecycle = createProfileBackedAgentLifecycle({
      components: {
        crux: { marker: 'crux' } as never,
        agent: { marker: 'agent' } as never,
      },
      driver,
      model,
      name: 'Tool Agent',
      prompt: basePrompt,
      storage: () => inMemoryRecordStore(),
      tools: {
        directTool,
      },
    })

    await lifecycle.invokeText({
      ctx: {},
      target: { threadId: 'thread-tools' },
      args: {
        input: {
          message: 'look up crux',
        },
      },
    })

    expect(driver.createdTools.map((definition) => definition.name)).toEqual(['runtimeLookup'])
    expect(driver.wrappedTools).toEqual([{ tool: directTool, name: 'directTool' }])

    const preparedTool = driver.definitions[0]?.tools.runtimeLookup as
      | {
          execute?: (
            toolCtx: unknown,
            args: Record<string, unknown>,
            options?: { toolCallId?: string },
          ) => Promise<unknown> | unknown
        }
      | undefined
    const result = await Promise.resolve(preparedTool?.execute?.({}, { query: 'crux' }, { toolCallId: 'call_lookup' }))
    expect(result).toEqual({
      query: 'crux',
      threadId: 'thread-tools',
      toolCallId: 'call_lookup',
    })
  })
})
