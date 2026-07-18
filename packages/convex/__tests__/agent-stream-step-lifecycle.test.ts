import { afterEach, describe, expect, it, vi } from 'vitest'
import { Agent as ConvexAgentBase } from '@convex-dev/agent'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '@use-crux/core/observability'
import { Agent } from '../src/agent'

describe('agent stream step lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    resetObservabilityRuntime()
  })

  it('opens stream step spans from prepareStep before the model step finishes', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    let releaseStep: (() => void) | undefined
    const stepGate = new Promise<void>((resolve) => {
      releaseStep = resolve
    })
    vi.spyOn(ConvexAgentBase.prototype, 'streamText').mockImplementation(async function (
      _ctx: unknown,
      _threadOpts: unknown,
      streamArgs: {
        prepareStep?: (options: unknown) => Promise<unknown> | unknown
        onStepFinish?: (step: unknown) => Promise<void> | void
      },
    ) {
      await streamArgs.prepareStep?.({ stepNumber: 0 })
      await stepGate
      await streamArgs.onStepFinish?.({
        stepNumber: 0,
        finishReason: 'stop',
        usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8 },
      })
      return {} as never
    } as never)
    const agent = new Agent({} as never, {
      name: 'Support Agent',
      languageModel: {} as never,
      tools: {},
    })

    const streamPromise = observe.run({ name: 'chat', rootPrimitive: 'agent.run' }, async () => {
      const { thread } = await agent.continueThread({} as never, { threadId: 'thread-1', userId: 'user-1' })
      await thread.streamText({} as never, { saveStreamDeltas: true } as never)
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    const stepStart = transport.records.find(
      (record) => record.type === 'span:start' && record.primitive === 'generation.call',
    )
    expect(stepStart).toMatchObject({
      name: 'step 1',
      attributes: expect.objectContaining({
        source: 'convex.agent.step',
        stepNumber: 0,
      }),
    })
    expect(
      transport.records.filter(
        (record) =>
          record.type === 'span:end' &&
          record.spanId === (stepStart?.type === 'span:start' ? stepStart.spanId : undefined),
      ),
    ).toHaveLength(0)

    releaseStep?.()
    await streamPromise
    await observe.flush()

    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:end',
        spanId: stepStart?.type === 'span:start' ? stepStart.spanId : undefined,
        status: 'ok',
        metrics: expect.objectContaining({ totalTokens: 8 }),
      }),
    )
  })

  it('records Convex Agent step lifecycle without closing the stream span early', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    vi.spyOn(ConvexAgentBase.prototype, 'streamText').mockImplementation(async function (
      _ctx: unknown,
      _threadOpts: unknown,
      streamArgs: {
        onStepFinish?: (step: unknown) => Promise<void> | void
      },
    ) {
      await streamArgs.onStepFinish?.({
        finishReason: 'stop',
        usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8 },
      })
      return await new Promise(() => undefined)
    } as never)
    const agent = new Agent({} as any, {
      name: 'Support Agent',
      languageModel: {} as any,
      tools: {},
    })

    await observe.run({ name: 'chat', rootPrimitive: 'agent.run' }, async () => {
      const { thread } = await agent.continueThread({} as any, { threadId: 'thread-1', userId: 'user-1' })
      void thread.streamText({} as any, { saveStreamDeltas: true } as any)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    await observe.flush()

    const generationStart = transport.records.find(
      (record) => record.type === 'span:start' && record.primitive === 'generation.stream',
    )
    const stepStart = transport.records.find(
      (record) => record.type === 'span:start' && record.primitive === 'generation.call',
    )
    expect(generationStart).toBeDefined()
    expect(stepStart).toMatchObject({
      parentSpanId: generationStart?.type === 'span:start' ? generationStart.spanId : undefined,
      attributes: expect.objectContaining({ finishReason: 'stop' }),
    })
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:event',
        spanId: stepStart?.type === 'span:start' ? stepStart.spanId : undefined,
        name: 'generation.step',
        attributes: expect.objectContaining({
          finishReason: 'stop',
        }),
      }),
    )
    expect(
      transport.records.filter(
        (record) =>
          record.type === 'span:end' &&
          record.spanId === (generationStart?.type === 'span:start' ? generationStart.spanId : undefined),
      ),
    ).toHaveLength(0)
  })

  it('records stop-condition tool calls without closing the stream span early', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    vi.spyOn(ConvexAgentBase.prototype, 'streamText').mockImplementation(async function (
      _ctx: unknown,
      _threadOpts: unknown,
      streamArgs: {
        onStepFinish?: (step: unknown) => Promise<void> | void
      },
    ) {
      await streamArgs.onStepFinish?.({
        finishReason: 'tool-calls',
        toolCalls: [{ toolCallId: 'call_question_lifecycle', toolName: 'askUserQuestion', input: { questions: [] } }],
      })
      return await new Promise(() => undefined)
    } as never)
    const agent = new Agent({} as any, {
      name: 'Support Agent',
      languageModel: {} as any,
      tools: {},
    })

    await observe.run({ name: 'chat', rootPrimitive: 'agent.run' }, async () => {
      const { thread } = await agent.continueThread({} as any, { threadId: 'thread-1', userId: 'user-1' })
      void thread.streamText({} as any, { saveStreamDeltas: true } as any)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    await observe.flush()

    const generationStart = transport.records.find(
      (record) => record.type === 'span:start' && record.primitive === 'generation.stream',
    )
    const stepStart = transport.records.find(
      (record) => record.type === 'span:start' && record.primitive === 'generation.call',
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:start',
        name: 'askUserQuestion',
        primitive: 'tool.call',
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:event',
        spanId: stepStart?.type === 'span:start' ? stepStart.spanId : undefined,
        name: 'generation.step',
        attributes: expect.objectContaining({
          finishReason: 'tool-calls',
          stopConditionTool: 'askUserQuestion',
        }),
      }),
    )
    expect(
      transport.records.filter(
        (record) =>
          record.type === 'span:end' &&
          record.spanId === (generationStart?.type === 'span:start' ? generationStart.spanId : undefined),
      ),
    ).toHaveLength(0)
  })

  it('records non-terminal tool-call steps without closing the stream span early', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    vi.spyOn(ConvexAgentBase.prototype, 'streamText').mockImplementation(async function (
      _ctx: unknown,
      _threadOpts: unknown,
      streamArgs: {
        onStepFinish?: (step: unknown) => Promise<void> | void
      },
    ) {
      await streamArgs.onStepFinish?.({
        finishReason: 'tool-calls',
        toolCalls: [{ toolCallId: 'call_writer_step', toolName: 'writer', input: { instruction: 'edit' } }],
      })
      return await new Promise(() => undefined)
    } as never)
    const agent = new Agent({} as any, {
      name: 'Support Agent',
      languageModel: {} as any,
      tools: {},
    })

    await observe.run({ name: 'chat', rootPrimitive: 'agent.run' }, async () => {
      const { thread } = await agent.continueThread({} as any, { threadId: 'thread-1', userId: 'user-1' })
      void thread.streamText({} as any, { saveStreamDeltas: true } as any)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    await observe.flush()

    const generationStart = transport.records.find(
      (record) => record.type === 'span:start' && record.primitive === 'generation.stream',
    )
    const stepStart = transport.records.find(
      (record) => record.type === 'span:start' && record.primitive === 'generation.call',
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:event',
        spanId: stepStart?.type === 'span:start' ? stepStart.spanId : undefined,
        name: 'generation.step',
        attributes: expect.objectContaining({
          finishReason: 'tool-calls',
        }),
      }),
    )
    expect(
      transport.records.filter(
        (record) =>
          record.type === 'span:end' &&
          record.spanId === (generationStart?.type === 'span:start' ? generationStart.spanId : undefined),
      ),
    ).toHaveLength(0)
  })
})
