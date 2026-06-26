import type { LanguageModelV3 } from '@ai-sdk/provider'
import { prompt } from '@use-crux/core'
import { resetObservabilityRuntime } from '@use-crux/core/observability'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createProfileBackedAgentLifecycle } from '../agent/lifecycle'
import { inMemoryCruxStore, memory, recentMessages } from '../memory'
import { skill } from '../skill'
import { FakeConvexAgentDriver } from './fixtures/fakeAgentDriver'

describe('profile-backed Convex Agent persistence lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    resetObservabilityRuntime()
  })

  it('persists active skill ids and hydrates them into later turns through the active Crux store', async () => {
    const driver = new FakeConvexAgentDriver()
    const store = inMemoryCruxStore()
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
      await Promise.resolve(tools.__crux_LoadSkill?.execute?.({}, { name: 'copy-editing' }, { toolCallId: 'skill-1' }))
    }
    const copyEditing = skill.inline({
      id: 'copy-editing',
      description: 'Copy editing guidance.',
      instructions: 'Preserve claims and tighten sentences.',
    })
    const basePrompt = prompt({
      id: 'skill-agent',
      input: z.object({ message: z.string() }),
      use: [copyEditing],
      prompt: ({ input }) => input.message,
    })
    const lifecycle = createProfileBackedAgentLifecycle({
      components: {
        crux: { marker: 'crux' } as never,
        agent: { marker: 'agent' } as never,
      },
      driver,
      model: {} as LanguageModelV3,
      name: 'Skill Agent',
      prompt: basePrompt,
      store: () => store,
    })

    await lifecycle.invokeText({
      ctx: {},
      target: { threadId: 'thread-skills' },
      args: {
        input: {
          message: 'edit this',
        },
      },
    })

    await expect(store.get('convex-agent:thread-skills:skills')).resolves.toMatchObject({
      activeSkillIds: ['copy-editing'],
    })

    const resolved = await lifecycle.resolveOnly({
      ctx: {},
      target: { threadId: 'thread-skills' },
      args: {
        input: {
          message: 'edit again',
        },
      },
    })
    expect(resolved.system).toContain('Preserve claims and tighten sentences.')
  })

  it('keeps generated text successful when best-effort memory capture persistence fails', async () => {
    const driver = new FakeConvexAgentDriver()
    const failingStore = {
      ...inMemoryCruxStore(),
      set: async () => {
        throw new Error('store write failed')
      },
    }
    const turnMemory = memory({
      id: 'turn-memory',
      blocks: [recentMessages({ id: 'recent' })],
    })
    const basePrompt = prompt({
      id: 'memory-agent',
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
      model: {} as LanguageModelV3,
      name: 'Memory Agent',
      prompt: basePrompt,
      store: () => failingStore,
    })

    await expect(
      lifecycle.invokeText({
        ctx: {},
        target: { threadId: 'thread-memory' },
        args: {
          input: {
            message: 'remember this',
          },
        },
      }),
    ).resolves.toEqual({ text: 'generated text' })
  })
})
