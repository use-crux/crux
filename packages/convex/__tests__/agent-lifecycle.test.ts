import type { LanguageModelV3 } from '@ai-sdk/provider'
import { prompt } from '@crux/core'
import { resetObservabilityRuntime } from '@crux/core/observability'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { context } from '../context'
import { createProfileBackedAgentLifecycle } from '../agent/lifecycle'
import { inMemoryCruxStore } from '../memory'
import { tool } from '../tools'
import { FakeConvexAgentDriver } from './fixtures/fakeAgentDriver'

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
})
