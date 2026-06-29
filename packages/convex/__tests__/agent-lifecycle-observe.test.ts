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
import { convexAgent } from '../agent'
import { inMemoryCruxStore } from '../memory'
import { FakeConvexAgentDriver } from './fixtures/fakeAgentDriver'

describe('profile-backed Convex Agent observability config', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    resetObservabilityRuntime()
  })

  it('accepts Crux-only observability controls under the public crux namespace', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const driver = new FakeConvexAgentDriver()
    const basePrompt = prompt({
      id: 'observed-config-agent',
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
      name: 'Observed Config Agent',
      prompt: basePrompt,
      crux: {
        driver,
        runtime: {
          store: () => inMemoryCruxStore(),
        },
        observe: {
          name: ({ operation, target }) => `Observed ${operation} ${target.threadId}`,
          attributes: ({ agentName, operation, target }) => ({
            agentName: 'configured-overwrite-attempt',
            configuredAgentName: agentName,
            configuredOperation: operation,
            configuredThreadId: target.threadId,
            operation: 'configured-overwrite-attempt',
            threadId: 'configured-overwrite-attempt',
          }),
        },
      },
    })

    await agent.generateText(
      { marker: 'ctx' },
      { threadId: 'thread-observe' },
      {
        input: {
          message: 'hello',
        },
      },
    )
    await observe.flush()

    const agentSpan = transport.records.find(
      (record) => record.type === 'span:start' && record.primitive === 'agent.run',
    )
    expect(agentSpan).toMatchObject({
      name: 'Observed generateText thread-observe',
      attributes: expect.objectContaining({
        agentName: 'Observed Config Agent',
        operation: 'generateText',
        promptId: 'observed-config-agent',
        threadId: 'thread-observe',
        configuredAgentName: 'Observed Config Agent',
        configuredOperation: 'generateText',
        configuredThreadId: 'thread-observe',
      }),
    })
  })

  it('can disable the profile agent run span through crux.observe', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const driver = new FakeConvexAgentDriver()
    const basePrompt = prompt({
      id: 'disabled-observe-agent',
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
      name: 'Disabled Observe Agent',
      prompt: basePrompt,
      crux: {
        driver,
        runtime: {
          store: () => inMemoryCruxStore(),
        },
        observe: {
          enabled: false,
        },
      },
    })

    await agent.generateText(
      { marker: 'ctx' },
      { threadId: 'thread-hidden-observe' },
      {
        input: {
          message: 'hello',
        },
      },
    )
    await observe.flush()

    expect(driver.generatedTextCalls).toHaveLength(1)
    expect(
      transport.records.find((record) => record.type === 'span:start' && record.primitive === 'agent.run'),
    ).toBeUndefined()
  })
})
