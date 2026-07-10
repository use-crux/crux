import type { LanguageModelV3 } from '@ai-sdk/provider'
import { prompt } from '@use-crux/core'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '@use-crux/core/observability'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createProfileBackedAgentLifecycle } from '../src/agent/lifecycle'
import { inMemoryRecordStore, memory, recentMessages } from '../src/memory'
import { getConvexCruxRuntime } from '../src/runtime'
import { tool } from '../src/tools'
import { FakeConvexAgentDriver } from './fixtures/fakeAgentDriver'

describe('profile-backed Convex Agent runtime lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    resetObservabilityRuntime()
  })

  it('uses one request-scoped store across prepare, prompt resolution, tool execution, and post-turn capture', async () => {
    const driver = new FakeConvexAgentDriver()
    const baseStore = inMemoryRecordStore()
    const storeEvents: string[] = []
    const store = {
      ...baseStore,
      put: async (...args: Parameters<typeof baseStore.put>) => {
        storeEvents.push(`put:${args[0]}`)
        await baseStore.put(...args)
      },
    }
    let storeFactoryCalls = 0
    let prepareSawStore = false
    let toolSawStore = false
    const runtimeCheck = tool({
      name: 'runtimeCheck',
      description: 'Check request-scoped runtime binding.',
      input: z.object({ value: z.string() }),
      execute: ({ input, target }) => {
        const runtime = getConvexCruxRuntime()
        toolSawStore = runtime?.records === store
        return {
          value: input.value,
          threadId: target.threadId,
          toolCallId: target.toolCallId,
        }
      },
    })
    driver.textResult = { text: 'stored assistant reply' }
    driver.onGenerateText = async ({ args }) => {
      const tools = args.tools as Record<
        string,
        | {
            execute?: (
              toolCtx: unknown,
              args: Record<string, unknown>,
              options?: { toolCallId?: string },
            ) => Promise<unknown> | unknown
          }
        | undefined
      >
      await Promise.resolve(tools.runtimeCheck?.execute?.({}, { value: 'from-tool' }, { toolCallId: 'call_runtime' }))
    }
    const turnMemory = memory({
      id: 'request-scope-memory',
      blocks: [recentMessages({ id: 'recent' })],
    })
    const basePrompt = prompt({
      id: 'request-scope-agent',
      input: z.object({ message: z.string() }),
      use: [turnMemory],
      prompt: ({ input }) => input.message,
    })
    const lifecycle = createProfileBackedAgentLifecycle({
      components: {
        crux: { marker: 'crux' } as never,
        agent: { marker: 'agent' } as never,
      },
      driver,
      languageModel: {} as LanguageModelV3,
      name: 'Request Scope Agent',
      prompt: basePrompt,
      storage: () => {
        storeFactoryCalls += 1
        return store
      },
      prepare: ({ input }) => {
        prepareSawStore = getConvexCruxRuntime()?.records === store
        return {
          input,
          tools: {
            runtimeCheck,
          },
        }
      },
    })

    await expect(
      lifecycle.invokeText({
        ctx: {},
        target: { threadId: 'thread-request-scope' },
        args: {
          input: {
            message: 'remember the scope',
          },
        },
      }),
    ).resolves.toEqual({ text: 'stored assistant reply' })

    expect(storeFactoryCalls).toBe(1)
    expect(prepareSawStore).toBe(true)
    expect(toolSawStore).toBe(true)
    expect(storeEvents.length).toBeGreaterThan(0)
  })

  it('patches stream onFinish and returns promise-valued stream metadata without awaiting it', async () => {
    const driver = new FakeConvexAgentDriver()
    const baseStore = inMemoryRecordStore()
    const events: string[] = []
    const store = {
      ...baseStore,
      put: async (...args: Parameters<typeof baseStore.put>) => {
        events.push(`store:${args[0]}`)
        await baseStore.put(...args)
      },
    }
    const pendingMetadata = new Promise<unknown>(() => {})
    const streamResult = {
      textStream: 'streamed text',
      totalUsage: pendingMetadata,
    }
    const finishResult = { text: 'finished stream text' }
    driver.streamResult = streamResult
    driver.onStreamText = async ({ args }) => {
      const onFinish = args.onFinish
      events.push('driver:before-finish')
      if (typeof onFinish === 'function') {
        await Promise.resolve(onFinish(finishResult))
      }
      events.push('driver:after-finish')
    }
    const turnMemory = memory({
      id: 'stream-memory',
      blocks: [recentMessages({ id: 'recent' })],
    })
    const basePrompt = prompt({
      id: 'stream-agent',
      input: z.object({ message: z.string() }),
      use: [turnMemory],
      prompt: ({ input }) => input.message,
    })
    const userOnFinish = vi.fn(async (result: unknown) => {
      events.push('user:on-finish')
      expect(result).toBe(finishResult)
    })
    const lifecycle = createProfileBackedAgentLifecycle({
      components: {
        crux: { marker: 'crux' } as never,
        agent: { marker: 'agent' } as never,
      },
      driver,
      languageModel: {} as LanguageModelV3,
      name: 'Stream Agent',
      prompt: basePrompt,
      storage: () => store,
    })

    await expect(
      lifecycle.invokeStream({
        ctx: {},
        target: { threadId: 'thread-stream' },
        args: {
          input: {
            message: 'stream this',
          },
          onFinish: userOnFinish,
        },
      }),
    ).resolves.toBe(streamResult)

    expect(userOnFinish).toHaveBeenCalledWith(finishResult)
    const userFinishIndex = events.indexOf('user:on-finish')
    expect(userFinishIndex).toBeGreaterThan(-1)
    expect(events.some((event, index) => event.startsWith('store:') && index < userFinishIndex)).toBe(true)
    expect(events.at(-1)).toBe('driver:after-finish')
  })

  it('rethrows driver failures while recording normalized agent run error evidence', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const driver = new FakeConvexAgentDriver()
    const driverError = new Error('driver generate failed')
    driverError.stack = 'Error: driver generate failed\n    at fake driver'
    driver.onGenerateText = () => {
      throw driverError
    }
    const basePrompt = prompt({
      id: 'failing-agent',
      input: z.object({ message: z.string() }),
      prompt: ({ input }) => input.message,
    })
    const lifecycle = createProfileBackedAgentLifecycle({
      components: {
        crux: { marker: 'crux' } as never,
        agent: { marker: 'agent' } as never,
      },
      driver,
      languageModel: {} as LanguageModelV3,
      name: 'Failing Agent',
      prompt: basePrompt,
      storage: () => inMemoryRecordStore(),
    })

    await expect(
      lifecycle.invokeText({
        ctx: {},
        target: { threadId: 'thread-failure' },
        args: {
          input: {
            message: 'fail please',
          },
        },
      }),
    ).rejects.toBe(driverError)
    await observe.flush()

    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:event',
        name: 'exception',
        attributes: expect.objectContaining({
          agentName: 'Failing Agent',
          operation: 'generateText',
          'exception.message': 'driver generate failed',
          'exception.type': 'Error',
        }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:end',
        status: 'error',
        error: expect.objectContaining({
          message: 'driver generate failed',
          name: 'Error',
        }),
        attributes: expect.objectContaining({
          agentName: 'Failing Agent',
          operation: 'generateText',
          toolCount: 0,
        }),
      }),
    )
  })
})
