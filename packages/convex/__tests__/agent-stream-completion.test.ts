import { afterEach, describe, expect, it, vi } from 'vitest'
import { Agent as ConvexAgentBase } from '@convex-dev/agent'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '@use-crux/core/observability'
import { Agent } from '../src/agent'

describe('agent stream completion', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    resetObservabilityRuntime()
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
      name: 'Support Agent',
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
      name: 'Support Agent',
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
      name: 'Support Agent',
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
      name: 'Support Agent',
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
})
