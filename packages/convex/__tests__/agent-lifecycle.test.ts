import type { LanguageModelV3 } from '@ai-sdk/provider'
import { prompt } from '@use-crux/core'
import { resetObservabilityRuntime } from '@use-crux/core/observability'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { context } from '../context'
import { createProfileBackedAgentLifecycle } from '../agent/lifecycle'
import { inMemoryCruxStore } from '../memory'
import { tool } from '../tools'
import { FakeConvexAgentDriver } from './fixtures/fakeAgentDriver'

function createObjectLifecycle(driver: FakeConvexAgentDriver) {
  const output = z.object({
    title: z.string(),
  })
  const basePrompt = prompt({
    id: 'object-agent',
    input: z.object({
      topic: z.string(),
    }),
    output,
    system: 'Return structured editorial metadata.',
    prompt: ({ input }) => `topic:${input.topic}`,
  })
  const lifecycle = createProfileBackedAgentLifecycle({
    components: {
      crux: { marker: 'crux' } as never,
      agent: { marker: 'agent' } as never,
    },
    driver,
    languageModel: {} as LanguageModelV3,
    name: 'Object Agent',
    prompt: basePrompt,
    store: () => inMemoryCruxStore(),
  })
  return { lifecycle, output }
}

describe('profile-backed Convex Agent lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    resetObservabilityRuntime()
  })

  it('preserves the Convex Agent generateText call shape while injecting resolved Crux prompt state', async () => {
    const driver = new FakeConvexAgentDriver()
    const model = {
      provider: 'openrouter',
      modelId: 'anthropic/claude-sonnet-4.5',
    } satisfies Partial<LanguageModelV3> as LanguageModelV3

    const lookup = tool({
      name: 'lookup',
      description: 'Lookup project facts.',
      input: z.object({ query: z.string() }),
      execute: ({ input, target }) => `${target.threadId}:${input.query}`,
    })
    const draftContext = context({
      id: 'draft',
      input: z.object({
        draftId: z.string(),
        currentPrompt: z.string(),
      }),
      system: ({ input }) => `currentPrompt=${input.currentPrompt}`,
      tools: {
        lookup,
      },
    })
    const writerPrompt = prompt({
      id: 'writer',
      input: z.object({
        draftId: z.string(),
        currentPrompt: z.string().optional(),
      }),
      system: 'Write with care.',
      prompt: ({ input }) => `draft:${input.draftId}`,
    })
    const lifecycle = createProfileBackedAgentLifecycle({
      components: {
        crux: { marker: 'crux' } as never,
        agent: { marker: 'agent' } as never,
      },
      driver,
      model,
      name: 'Writer',
      prompt: writerPrompt,
      store: () => inMemoryCruxStore(),
      prepare: ({ input }) => ({
        input: {
          ...input,
          currentPrompt: 'expand the outline',
        },
        use: [draftContext],
        tokenBudget: 123,
      }),
    })

    const result = await lifecycle.invokeText({
      ctx: { marker: 'ctx' },
      target: { threadId: 'thread-1', userId: 'user-1' },
      args: {
        input: {
          draftId: 'draft-1',
        },
        promptMessageId: 'message-1',
      },
      options: {
        saveMessage: true,
      },
    })

    expect(result).toEqual({ text: 'generated text' })
    expect(driver.definitions).toHaveLength(1)
    expect(driver.definitions[0]).toMatchObject({
      component: { marker: 'agent' },
      name: 'Writer',
      languageModel: model,
      instructions: expect.stringContaining('Write with care.'),
    })
    expect(driver.definitions[0]?.instructions).toContain('currentPrompt=expand the outline')
    expect(driver.definitions[0]?.tools).toHaveProperty('lookup')
    expect(driver.generatedTextCalls).toEqual([
      {
        ctx: { marker: 'ctx' },
        target: { threadId: 'thread-1', userId: 'user-1' },
        args: expect.objectContaining({
          promptMessageId: 'message-1',
          prompt: 'draft:draft-1',
          system: expect.stringContaining('currentPrompt=expand the outline'),
          tools: driver.definitions[0]?.tools,
        }),
        options: {
          saveMessage: true,
        },
      },
    ])
  })

  it('accepts Convex Agent languageModel naming without requiring the legacy model alias', async () => {
    const driver = new FakeConvexAgentDriver()
    const languageModel = {
      provider: 'openrouter',
      modelId: 'openai/gpt-5-mini',
    } satisfies Partial<LanguageModelV3> as LanguageModelV3
    const basePrompt = prompt({
      id: 'language-model-agent',
      input: z.object({
        message: z.string(),
      }),
      prompt: ({ input }) => input.message,
    })
    const lifecycle = createProfileBackedAgentLifecycle({
      components: {
        crux: { marker: 'crux' } as never,
        agent: { marker: 'agent' } as never,
      },
      driver,
      languageModel,
      name: 'Language Model Agent',
      prompt: basePrompt,
      store: () => inMemoryCruxStore(),
    })

    await lifecycle.resolveOnly({
      ctx: {},
      target: { threadId: 'thread-language-model' },
      args: {
        input: {
          message: 'hello',
        },
      },
    })

    expect(driver.definitions[0]?.languageModel).toBe(languageModel)
  })

  it('preserves the Convex Agent generateObject call shape while injecting resolved schema and prompt state', async () => {
    const driver = new FakeConvexAgentDriver()
    driver.objectResult = { object: { title: 'Draft title' } }
    const { lifecycle, output } = createObjectLifecycle(driver)

    const result = await lifecycle.invokeObject({
      ctx: { marker: 'ctx' },
      target: { threadId: 'thread-object', userId: 'user-object' },
      args: {
        input: {
          topic: 'Crux',
        },
        temperature: 0.1,
      },
      options: {
        storageOptions: { saveMessages: 'promptAndOutput' },
      },
    })

    expect(result).toEqual({ object: { title: 'Draft title' } })
    expect(driver.generatedObjectCalls).toEqual([
      {
        ctx: { marker: 'ctx' },
        target: { threadId: 'thread-object', userId: 'user-object' },
        args: expect.objectContaining({
          temperature: 0.1,
          prompt: 'topic:Crux',
          system: expect.stringContaining('Return structured editorial metadata.'),
          schema: output,
          tools: driver.definitions[0]?.tools,
        }),
        options: {
          storageOptions: { saveMessages: 'promptAndOutput' },
        },
      },
    ])
    expect(driver.generatedObjectCalls[0]?.args).not.toHaveProperty('input')
  })

  it('preserves the Convex Agent streamObject call shape while injecting resolved schema and prompt state', async () => {
    const driver = new FakeConvexAgentDriver()
    driver.objectStreamResult = { partialObjectStream: 'streamed object' }
    const userOnFinish = vi.fn()
    driver.onStreamObject = async ({ args }) => {
      await (args.onFinish as (result: unknown) => Promise<void>)({ object: { title: 'Streamed title' } })
    }
    const { lifecycle, output } = createObjectLifecycle(driver)

    const result = await lifecycle.invokeObjectStream({
      ctx: { marker: 'ctx' },
      target: { threadId: 'thread-object-stream', userId: 'user-object' },
      args: {
        input: {
          topic: 'Crux',
        },
        temperature: 0.1,
        onFinish: userOnFinish,
      },
      options: {
        storageOptions: { saveMessages: 'promptAndOutput' },
      },
    })

    expect(result).toEqual({ partialObjectStream: 'streamed object' })
    expect(userOnFinish).toHaveBeenCalledWith({ object: { title: 'Streamed title' } })
    expect(driver.streamedObjectCalls).toEqual([
      {
        ctx: { marker: 'ctx' },
        target: { threadId: 'thread-object-stream', userId: 'user-object' },
        args: expect.objectContaining({
          temperature: 0.1,
          prompt: 'topic:Crux',
          system: expect.stringContaining('Return structured editorial metadata.'),
          schema: output,
          tools: driver.definitions[0]?.tools,
        }),
        options: {
          storageOptions: { saveMessages: 'promptAndOutput' },
        },
      },
    ])
    expect(driver.streamedObjectCalls[0]?.args).not.toHaveProperty('input')
  })

})
