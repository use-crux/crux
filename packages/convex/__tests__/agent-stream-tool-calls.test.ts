import { afterEach, describe, expect, it, vi } from 'vitest'
import { Agent as ConvexAgentBase } from '@convex-dev/agent'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '@use-crux/core/observability'
import { Agent } from '../src/agent'

describe('agent stream tool calls', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    resetObservabilityRuntime()
  })

  it('records interactive Convex Agent tool-call parts when no execute span fires', async () => {
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
        toolCalls: [{ toolCallId: 'call_question_fallback', toolName: 'askUserQuestion', input: { questions: [] } }],
      })
      await streamArgs.onFinish?.({})
      return {} as never
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

    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:start',
        name: 'askUserQuestion',
        primitive: 'tool.call',
        attributes: expect.objectContaining({
          toolName: 'askUserQuestion',
          toolCallId: 'call_question_fallback',
          source: 'convex.agent.step',
          executed: false,
        }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'tool.request',
        attributes: expect.objectContaining({
          toolName: 'askUserQuestion',
          toolCallId: 'call_question_fallback',
        }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'tool.args',
        attributes: expect.objectContaining({
          toolName: 'askUserQuestion',
          toolCallId: 'call_question_fallback',
        }),
      }),
    )
  })

  it('does not create fallback execution spans for normal tool requests before the handler runs', async () => {
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
        toolCalls: [{ toolCallId: 'call_research_request', toolName: 'research', input: { queries: ['crux'] } }],
      })
      return {} as never
    } as never)
    const agent = new Agent({} as never, {
      name: 'Support Agent',
      languageModel: {} as never,
      tools: {},
    })

    await observe.run({ name: 'chat', rootPrimitive: 'agent.run' }, async () => {
      const { thread } = await agent.continueThread({} as never, { threadId: 'thread-1', userId: 'user-1' })
      await thread.streamText({} as never, { saveStreamDeltas: true } as never)
    })
    await observe.flush()

    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'tool.request',
        attributes: expect.objectContaining({
          toolName: 'research',
          toolCallId: 'call_research_request',
        }),
      }),
    )
    expect(
      transport.records.filter(
        (record) =>
          record.type === 'span:start' &&
          record.primitive === 'tool.call' &&
          record.name === 'research' &&
          record.attributes?.source === 'convex.agent.step',
      ),
    ).toHaveLength(0)
  })

  it('records only materialized stop-condition tool calls from returned Convex Agent stream results', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    vi.spyOn(ConvexAgentBase.prototype, 'streamText').mockImplementation(async function () {
      return {
        toolCalls: [
          {
            toolCallId: 'call_question_materialized',
            toolName: 'askUserQuestion',
            input: { questions: [{ id: 'tone', question: 'Tone?', options: [] }] },
          },
        ],
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

    const toolStart = transport.records.find(
      (record) => record.type === 'span:start' && record.primitive === 'tool.call',
    )
    const generationStart = transport.records.find(
      (record) => record.type === 'span:start' && record.primitive === 'generation.stream',
    )
    expect(toolStart).toMatchObject({
      name: 'askUserQuestion',
      parentSpanId: generationStart?.type === 'span:start' ? generationStart.spanId : undefined,
      attributes: expect.objectContaining({
        toolName: 'askUserQuestion',
        toolCallId: 'call_question_materialized',
        source: 'convex.agent.step',
        executed: false,
        stopCondition: true,
      }),
    })
    expect(
      transport.records.filter((record) => record.type === 'span:start' && record.primitive === 'tool.call'),
    ).toHaveLength(1)
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:end',
        spanId: generationStart?.type === 'span:start' ? generationStart.spanId : undefined,
        status: 'ok',
      }),
    )
  })
})
