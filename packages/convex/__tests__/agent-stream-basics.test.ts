import { afterEach, describe, expect, it, vi } from 'vitest'
import { Agent as ConvexAgentBase } from '@convex-dev/agent'
import type { CruxArtifactRecord } from '@use-crux/core/observability/contract'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '@use-crux/core/observability'
import { Agent } from '../src/agent'

describe('agent stream basics', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    resetObservabilityRuntime()
  })

  it('wraps Convex Agent thread streamText calls in generation spans', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const streamText = vi
      .spyOn(ConvexAgentBase.prototype, 'streamText')
      .mockImplementation(async function (
        _ctx: unknown,
        _threadOpts: unknown,
        streamArgs: {
          prepareStep?: (options: unknown) => Promise<void> | void
          onStepFinish?: (step: unknown) => Promise<void> | void
          onChunk?: (event: unknown) => Promise<void> | void
          onFinish?: (result: unknown) => Promise<void> | void
        },
      ) {
        await streamArgs.prepareStep?.({ stepNumber: 0 })
        await streamArgs.onStepFinish?.({
          stepNumber: 0,
          finishReason: 'stop',
          usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
        })
        await streamArgs.onChunk?.({
          chunk: { type: 'text-delta', text: 'hello' },
        })
        await streamArgs.onFinish?.({
          usage: {
            inputTokens: 11,
            outputTokens: 7,
            totalTokens: 18,
            cachedInputTokens: 3,
            reasoningTokens: 2,
          },
          cost: 0.012,
        })
        return {
          usage: {
            inputTokens: 11,
            outputTokens: 7,
            totalTokens: 18,
            cachedInputTokens: 3,
            reasoningTokens: 2,
          },
          cost: 0.012,
        } as never
      } as never)
    const languageModel = {
      provider: 'openrouter',
      modelId: 'google/gemini-3.1-flash-lite-preview-20260303',
    }
    const agent = new Agent({} as any, {
      name: 'Karyla',
      languageModel: languageModel as any,
      tools: {},
    })

    await observe.run(
      { name: 'chat', rootPrimitive: 'agent.run' },
      async () => {
        const { thread } = await agent.continueThread({} as any, {
          threadId: 'thread-1',
          userId: 'user-1',
        })
        await thread.streamText({} as any, { saveStreamDeltas: true } as any)
      },
    )
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
          provider: 'openrouter',
          model: 'google/gemini-3.1-flash-lite-preview-20260303',
          threadId: 'thread-1',
          userId: 'user-1',
        }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:start',
        name: 'step 1',
        family: 'generation',
        primitive: 'generation.call',
        attributes: expect.objectContaining({
          agentName: 'Karyla',
          stepMode: 'stream',
          output: 'text',
          source: 'convex.agent.step',
          provider: 'openrouter',
          model: 'google/gemini-3.1-flash-lite-preview-20260303',
          stepNumber: 0,
        }),
      }),
    )
    const usageEvent = transport.records.find(
      (record) =>
        record.type === 'span:event' && record.name === 'usage.observed',
    )
    expect(usageEvent).toMatchObject({
      attributes: expect.objectContaining({
        inputTokens: 11,
        outputTokens: 7,
        totalTokens: 18,
        cacheReadTokens: 3,
        reasoningTokens: 2,
        costUsd: 0.012,
        ttftMs: expect.any(Number),
        tokensPerSecond: expect.any(Number),
        totalChunks: 1,
      }),
    })
    expect(
      (usageEvent as { attributes?: Record<string, unknown> } | undefined)
        ?.attributes,
    ).not.toHaveProperty('cachedInputTokens')
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:end',
        spanId: (
          transport.records.find(
            (record) =>
              record.type === 'span:start' &&
              record.primitive === 'generation.stream',
          ) as { spanId?: string }
        ).spanId,
        status: 'ok',
      }),
    )
  })

  it('keeps stream args shared so context handlers can inject resolved prompt state', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    let forwardedSystem: unknown
    let forwardedTools: unknown
    vi.spyOn(ConvexAgentBase.prototype, 'streamText').mockImplementation(
      async function (
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
            allMessages: [{ role: 'user', content: 'Earlier question' }],
            search: [],
            recent: [{ role: 'assistant', content: 'Earlier answer' }],
            inputMessages: [{ role: 'user', content: 'Current question' }],
            inputPrompt: [{ role: 'user', content: 'Current prompt' }],
            existingResponses: [],
            userId: 'user-1',
            threadId: 'thread-1',
          },
        )
        forwardedSystem = streamArgs.system
        forwardedTools = streamArgs.tools
        return {} as never
      } as never,
    )
    const agent = new Agent({} as never, {
      name: 'Karyla',
      languageModel: {} as never,
      tools: {},
    })
    const callArgs: Record<string, unknown> = {}
    const resolvedTools = { lookup: { description: 'Lookup.' } }

    const { thread } = await agent.continueThread({} as never, {
      threadId: 'thread-1',
      userId: 'user-1',
    })
    await thread.streamText(
      callArgs as never,
      {
        contextHandler: async () => {
          callArgs.system = 'Resolved Crux system.'
          callArgs.tools = resolvedTools
          return []
        },
      } as never,
    )

    expect(forwardedSystem).toBe('Resolved Crux system.')
    expect(forwardedTools).toBe(resolvedTools)
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'messages',
        preview: expect.objectContaining({
          source: 'convex.agent',
          phase: 'thread-context',
          threadId: 'thread-1',
          allMessages: [{ role: 'user', content: 'Earlier question' }],
          recent: [{ role: 'assistant', content: 'Earlier answer' }],
          inputMessages: [{ role: 'user', content: 'Current question' }],
          inputPrompt: [{ role: 'user', content: 'Current prompt' }],
        }),
      }),
    )
  })

  it('redacts Agent-native media URLs from call argument artifacts', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    vi.spyOn(ConvexAgentBase.prototype, 'generateText').mockResolvedValue({
      text: 'ok',
    } as never)
    const agent = new Agent({} as never, {
      name: 'Karyla',
      languageModel: {} as never,
      tools: {},
    })

    await observe.run(
      { name: 'chat', rootPrimitive: 'agent.run' },
      async () => {
        await agent.generateText(
          {} as never,
          { threadId: 'thread-1', userId: 'user-1' },
          {
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: 'inspect this' },
                  {
                    type: 'image',
                    image: new URL('https://files.example/storage_existing_1?token=secret'),
                    mediaType: 'image/png',
                  },
                ],
              },
            ],
          } as never,
        )
      },
    )
    await observe.flush()

    const artifact = transport.records.find(
      (record): record is CruxArtifactRecord =>
        record.type === 'artifact' &&
        record.kind === 'messages' &&
        typeof record.preview === 'object' &&
        record.preview !== null &&
        'phase' in record.preview &&
        record.preview.phase === 'call-args',
    )
    const preview = JSON.stringify(artifact?.preview)
    expect(preview).toContain('"kind":"image"')
    expect(preview).toContain('"mediaType":"image/png"')
    expect(preview).toContain('"sourceCategory":"url"')
    expect(preview).not.toContain('https://files.example')
    expect(preview).not.toContain('storage_existing_1')
    expect(preview).not.toContain('token=secret')
  })
})
