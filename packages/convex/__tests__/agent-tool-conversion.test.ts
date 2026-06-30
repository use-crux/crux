import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createTool } from '@convex-dev/agent'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '@use-crux/core/observability'
import { Agent, convexTools } from '../agent'
import { tool as convexRuntimeTool } from '../tools'
import { inMemoryRecordStore } from '../memory'
import { runWithConvexCruxRuntime } from '../runtime'

describe('agent tool conversion', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    resetObservabilityRuntime()
  })

  it('converts Crux tool definitions to Convex Agent tools', async () => {
    const execute = vi.fn(async (args: Record<string, unknown>) => `hello ${args.name}`)

    const tools = convexTools({
      greet: {
        description: 'Greet a user.',
        parameters: z.object({ name: z.string() }),
        execute,
      },
    })

    expect(tools.greet.description).toBe('Greet a user.')
    expect(tools.greet.inputSchema).toBeDefined()

    const result = await tools.greet.execute?.call({ ctx: {} }, { name: 'Ada' }, {} as any)

    expect(result).toBe('hello Ada')
    expect(execute).toHaveBeenCalledWith({ name: 'Ada' })
  })

  it('propagates tool execution errors', async () => {
    const tools = convexTools({
      fail: {
        description: 'Fail.',
        parameters: z.object({}),
        execute: async () => {
          throw new Error('boom')
        },
      },
    })

    await expect(tools.fail.execute?.call({ ctx: {} }, {}, {} as any)).rejects.toThrow('boom')
  })

  it('records Crux tool execution errors with Convex tool metadata', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const tools = convexTools({
      fail: {
        description: 'Fail.',
        parameters: z.object({}),
        execute: async () => {
          const error = new Error('convex crux boom')
          error.stack = 'Error: convex crux boom\n    at convex crux tool'
          throw error
        },
      },
    })

    await expect(
      observe.run({ name: 'chat', rootPrimitive: 'agent.run' }, async () => {
        await tools.fail.execute?.call({ ctx: {} }, {}, { toolCallId: 'call_fail', messages: [] })
      }),
    ).rejects.toThrow('convex crux boom')
    await observe.flush()

    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:event',
        name: 'exception',
        attributes: expect.objectContaining({
          toolName: 'fail',
          toolCallId: 'call_fail',
          phase: 'tool.execute',
          errorKind: 'execute_error',
          'error.phase': 'tool.execute',
          'error.kind': 'execute_error',
          'exception.message': 'convex crux boom',
        }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'error.stack',
        attributes: expect.objectContaining({ toolName: 'fail', toolCallId: 'call_fail' }),
        preview: expect.stringContaining('convex crux boom'),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:end',
        status: 'error',
        error: { message: 'convex crux boom', name: 'Error', category: 'execute_error' },
        attributes: expect.objectContaining({
          toolName: 'fail',
          toolCallId: 'call_fail',
          phase: 'tool.execute',
          errorKind: 'execute_error',
        }),
      }),
    )
  })

  it('preserves captured Convex runtime and toolCallId for prompt-resolved Crux tools', async () => {
    const runtimeTool = convexRuntimeTool({
      name: 'runtimeLookup',
      description: 'Read runtime metadata.',
      input: z.object({ query: z.string() }),
      execute: ({ input, target }) => ({
        query: input.query,
        threadId: target.threadId,
        toolCallId: target.toolCallId,
      }),
    })
    const records = inMemoryRecordStore()
    const tools = runWithConvexCruxRuntime(
      {
        ctx: {},
        storage: { records },
        records,
        target: { threadId: 'thread-runtime' },
      },
      () => convexTools({ runtimeLookup: runtimeTool }),
    )
    const executable = tools.runtimeLookup as {
      execute?: (this: unknown, input: unknown, options?: { toolCallId?: string }) => unknown | Promise<unknown>
    }

    const result = await executable.execute?.call({ ctx: {} }, { query: 'crux' }, { toolCallId: 'call_runtime' })

    expect(result).toEqual({
      query: 'crux',
      threadId: 'thread-runtime',
      toolCallId: 'call_runtime',
    })
  })

  it('does not double-wrap prompt-resolved Crux tools when installed on an Agent', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const tools = convexTools({
      search: {
        description: 'Search.',
        parameters: z.object({ query: z.string() }),
        execute: async () => 'ok',
      },
    })
    const agent = new Agent({} as never, {
      name: 'Karyla',
      languageModel: {} as never,
      instructions: 'test',
      tools,
    })
    const installed = (
      agent as unknown as {
        options: {
          tools: Record<
            string,
            {
              execute?: (this: unknown, input: unknown, options?: { toolCallId?: string }) => unknown | Promise<unknown>
            }
          >
        }
      }
    ).options.tools.search

    await observe.run({ name: 'chat', rootPrimitive: 'agent.run' }, async () => {
      await installed?.execute?.call({ ctx: {} }, { query: 'crux' }, { toolCallId: 'call_search' })
    })
    await observe.flush()

    const toolStarts = transport.records.filter(
      (record) => record.type === 'span:start' && record.primitive === 'tool.call' && record.name === 'search',
    )
    expect(toolStarts).toHaveLength(1)
  })

  it('throws for non-Crux tool shapes', () => {
    expect(() => convexTools({ invalid: { description: 'no execute' } })).toThrow(/expected a Crux ToolDef/)
  })

  it('accepts already-authored Convex Agent tools', () => {
    const direct = createTool({
      description: 'Direct Convex Agent tool.',
      inputSchema: z.object({}),
      execute: async () => 'ok',
    })

    const tools = convexTools({ direct })

    expect(tools.direct).toBe(direct)
  })
})
