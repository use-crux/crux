import type { LanguageModelV3 } from '@ai-sdk/provider'
import { prompt } from '@use-crux/core'
import { resetObservabilityRuntime } from '@use-crux/core/observability'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { convexAgent } from '../src/agent'
import { inMemoryRecordStore } from '../src/memory'
import { FakeConvexAgentDriver } from './fixtures/fakeAgentDriver'

describe('profile-backed Convex Agent lifecycle config', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    resetObservabilityRuntime()
  })

  it('accepts Crux-only lifecycle controls under the public crux namespace', async () => {
    const driver = new FakeConvexAgentDriver()
    const basePrompt = prompt({
      id: 'namespaced-config-agent',
      input: z.object({
        message: z.string(),
      }),
      prompt: ({ input }) => input.message,
    })
    const agent = convexAgent({
      components: {
        crux: { marker: 'crux' } as never,
        agent: { marker: 'agent' } as never,
      },
      languageModel: {} as LanguageModelV3,
      name: 'Namespaced Config Agent',
      prompt: basePrompt,
      crux: {
        driver,
        runtime: {
          storage: () => inMemoryRecordStore(),
        },
        prepare: ({ input }) => ({
          input: {
            ...input,
            message: `prepared:${input.message}`,
          },
        }),
      },
    })

    await agent.generateText(
      { marker: 'ctx' },
      { threadId: 'thread-namespaced-config' },
      {
        input: {
          message: 'hello',
        },
      },
    )

    expect(driver.generatedTextCalls[0]?.args).toEqual(
      expect.objectContaining({
        prompt: 'prepared:hello',
      }),
    )
  })
})
