import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createTool } from '@convex-dev/agent'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '@use-crux/core/observability'
import { Agent, createTool as createCruxTool, wrapConvexTool } from '../src/agent'
import type { CruxConvexContext } from '../src/server'

describe('agent tool observability', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    resetObservabilityRuntime()
  })

  it('wraps direct Convex tools with human tool names', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const flushSpy = vi.spyOn(observe, 'flush')

    const execute = vi.fn(async () => 'ok')
    const tool = wrapConvexTool(
      createTool({
        description: 'Research.',
        inputSchema: z.object({}),
        execute,
      }),
      { name: 'research' },
    )

    await observe.run({ name: 'chat', rootPrimitive: 'agent.run' }, async () => {
      await tool.execute?.call({ ctx: { threadId: 'thread-1' } }, {}, { toolCallId: 'call_123' } as any)
    })
    await observe.flush()

    const span = transport.records.find((record) => record.type === 'span:start' && record.primitive === 'tool.call')
    expect(span).toMatchObject({
      name: 'research',
      family: 'tool',
      primitive: 'tool.call',
      attributes: {
        toolName: 'research',
        toolCallId: 'call_123',
      },
    })
    expect(flushSpy).toHaveBeenCalled()
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:end',
        spanId: span?.type === 'span:start' ? span.spanId : undefined,
        status: 'ok',
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'tool.args',
        attributes: expect.objectContaining({ toolName: 'research', toolCallId: 'call_123' }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'tool.result',
        attributes: expect.objectContaining({ toolName: 'research', toolCallId: 'call_123' }),
      }),
    )
  })

  it('records wrapped direct Convex tool execution errors with tool metadata', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const execute = vi.fn(async (): Promise<string> => {
      const error = new Error('direct convex boom')
      error.stack = 'Error: direct convex boom\n    at direct convex tool'
      throw error
    })
    const tool = wrapConvexTool(
      createTool({
        description: 'Research.',
        inputSchema: z.object({}),
        execute,
      }),
      { name: 'research' },
    )

    await expect(
      observe.run({ name: 'chat', rootPrimitive: 'agent.run' }, async () => {
        await tool.execute?.call({ ctx: {} }, {}, { toolCallId: 'call_direct', messages: [] })
      }),
    ).rejects.toThrow('direct convex boom')
    await observe.flush()

    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:event',
        name: 'exception',
        attributes: expect.objectContaining({
          toolName: 'research',
          toolCallId: 'call_direct',
          phase: 'tool.execute',
          errorKind: 'execute_error',
          'error.phase': 'tool.execute',
          'error.kind': 'execute_error',
          'exception.message': 'direct convex boom',
        }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'error.raw',
        attributes: expect.objectContaining({ toolName: 'research', toolCallId: 'call_direct' }),
        preview: expect.objectContaining({ message: 'direct convex boom', name: 'Error' }),
      }),
    )
  })

  it('uses the tools object key instead of the description for Crux createTool spans', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const tool = createCruxTool({
      description: 'CALL THIS TOOL with a long instruction that should never become the trace label.',
      inputSchema: z.object({}),
      execute: async () => 'ok',
    })
    const tools = { askUserQuestion: tool }
    const agent = new Agent({} as any, {
      name: 'Karyla',
      languageModel: {} as any,
      instructions: 'test',
      tools,
    })

    const wrapped = (agent as any).options.tools.askUserQuestion
    await observe.run({ name: 'chat', rootPrimitive: 'agent.run' }, async () => {
      await wrapped.execute?.call({ ctx: {} }, {}, { toolCallId: 'call_question' })
    })
    await observe.flush()

    const span = transport.records.find((record) => record.type === 'span:start' && record.primitive === 'tool.call')
    expect(span).toMatchObject({
      name: 'askUserQuestion',
      attributes: {
        toolName: 'askUserQuestion',
        toolCallId: 'call_question',
      },
    })
  })

  it('provides Crux helpers to direct Convex tool handlers', async () => {
    const ctx = {
      runAction: vi.fn(async (_ref: unknown, args: Record<string, unknown>) => args),
    }
    const execute = vi.fn(async (toolCtx) => {
      const cruxCtx = toolCtx as typeof ctx & { crux: CruxConvexContext }
      expect(cruxCtx.crux).toMatchObject({
        capture: expect.any(Function),
        runAction: expect.any(Function),
      })
      return await cruxCtx.crux.runAction('research', 'internal.agent.research', { query: 'crux' })
    })
    const tool = wrapConvexTool(
      createTool({
        description: 'Research.',
        inputSchema: z.object({}),
        execute,
      }),
      { name: 'research' },
    )

    const result = await observe.run({ name: 'chat', rootPrimitive: 'agent.run' }, async () => {
      return await tool.execute?.call({ ctx }, {}, { toolCallId: 'call_123' } as any)
    })

    expect(result).toMatchObject({
      query: 'crux',
      __crux: expect.objectContaining({
        v: 1,
        observability: expect.any(Object),
      }),
    })
    expect(ctx.runAction).toHaveBeenCalledWith(
      'internal.agent.research',
      expect.objectContaining({
        query: 'crux',
        __crux: expect.any(Object),
      }),
    )
  })

  it('creates Convex Agent tools with Crux tool spans by default', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const flushSpy = vi.spyOn(observe, 'flush')

    const execute = vi.fn(async () => 'ok')
    const tool = createCruxTool({
      title: 'search',
      description: 'Search.',
      inputSchema: z.object({ query: z.string() }),
      execute,
    })

    await observe.run({ name: 'chat', rootPrimitive: 'agent.run' }, async () => {
      await tool.execute?.call({ ctx: {} }, { query: 'crux' }, { toolCallId: 'call_search' } as any)
    })
    await observe.flush()

    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:start',
        name: 'search',
        primitive: 'tool.call',
        attributes: expect.objectContaining({
          toolName: 'search',
          toolCallId: 'call_search',
        }),
      }),
    )
    expect(flushSpy).toHaveBeenCalled()
  })

  it('wraps tools passed to the Crux-aware Convex Agent constructor', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const execute = vi.fn(async () => 'ok')
    const agent = new Agent({} as any, {
      name: 'Karyla',
      languageModel: {} as any,
      tools: {
        research: createTool({
          description: 'Research.',
          inputSchema: z.object({ query: z.string() }),
          execute,
        }),
      },
    })

    await observe.run({ name: 'chat', rootPrimitive: 'agent.run' }, async () => {
      await agent.options.tools?.research.execute?.call({ ctx: {} }, { query: 'crux' }, {
        toolCallId: 'call_agent',
      } as any)
    })
    await observe.flush()

    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:start',
        name: 'research',
        primitive: 'tool.call',
      }),
    )
  })
})
