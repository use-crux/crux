/**
 * Internal-module tests for `adapter/tool/emission` — the leak-free
 * instrumentation wrappers the ToolLifecycle session arms sdk-regime tools
 * with. `instrumentToolSet` is a session internal (not exported from any
 * public barrel); these tests pin the deferred-`onToolEnd` bookkeeping the
 * session hides: hook ordering, toModelOutput chaining, and pending-state
 * cleanup (the historical `@use-crux/ai` leak).
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { updateRuntime, resetRuntime } from '../../../runtime'
import { instrumentToolSet, renderToolModelOutput } from '../../../adapter/tool/emission'
import type { ToolModelOutput } from '../../../types/tool'

function registerHooks() {
  const hooks = {
    onToolStart: vi.fn(),
    onToolEnd: vi.fn(),
    onToolApprovalRequest: vi.fn(),
  }
  updateRuntime({ instrumentationHooks: hooks })
  return hooks
}

afterEach(() => {
  resetRuntime()
})

describe('instrumentToolSet', () => {
  it('returns tools unchanged when no instrumentation hooks are registered', () => {
    const tools = { echo: { description: 'echo', execute: async (input: unknown) => input } }
    expect(instrumentToolSet(tools)).toBe(tools)
  })

  it('fires onToolStart then onToolEnd around execute with default model output', async () => {
    const hooks = registerHooks()
    const tools = instrumentToolSet({
      echo: { description: 'echo', execute: async () => 'hello' },
    })!

    const result = await (tools.echo as { execute: (i: unknown, o: object) => Promise<unknown> }).execute(
      { q: 1 },
      { toolCallId: 'tc_1' },
    )

    expect(result).toBe('hello')
    expect(hooks.onToolStart).toHaveBeenCalledWith(expect.objectContaining({ toolCallId: 'tc_1', toolName: 'echo' }))
    expect(hooks.onToolEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: 'tc_1',
        toolName: 'echo',
        result: 'hello',
        modelOutput: { type: 'text', value: 'hello' },
        modelOutputType: 'text',
      }),
    )
    expect(hooks.onToolStart.mock.invocationCallOrder[0]!).toBeLessThan(hooks.onToolEnd.mock.invocationCallOrder[0]!)
  })

  it('reports execute errors through onToolEnd and rethrows', async () => {
    const hooks = registerHooks()
    const tools = instrumentToolSet({
      boom: {
        execute: async () => {
          throw new Error('kaboom')
        },
      },
    })!

    await expect(
      (tools.boom as { execute: (i: unknown, o: object) => Promise<unknown> }).execute({}, { toolCallId: 'tc_2' }),
    ).rejects.toThrow('kaboom')
    expect(hooks.onToolEnd).toHaveBeenCalledWith(expect.objectContaining({ toolCallId: 'tc_2', error: 'kaboom' }))
  })

  it("leaves needsApproval unwrapped — approval hooks are the lifecycle session's to emit", async () => {
    registerHooks()
    const needsApproval = async () => true
    const tools = instrumentToolSet({
      guarded: { execute: async () => 'ok', needsApproval },
    })!

    expect((tools.guarded as { needsApproval: unknown }).needsApproval).toBe(needsApproval)
  })

  it('defers onToolEnd until toModelOutput resolves, chaining the original result', async () => {
    const hooks = registerHooks()
    const tools = instrumentToolSet({
      shaped: {
        execute: async () => ({ rows: [1, 2, 3] }),
        toModelOutput: async (): Promise<ToolModelOutput> => ({ type: 'text', value: '3 rows' }),
      },
    })!
    const tool = tools.shaped as {
      execute: (i: unknown, o: object) => Promise<unknown>
      toModelOutput: (a: { toolCallId: string; input: unknown; output: unknown }) => Promise<ToolModelOutput>
    }

    await tool.execute({}, { toolCallId: 'tc_5' })
    expect(hooks.onToolEnd).not.toHaveBeenCalled()

    const modelOutput = await tool.toModelOutput({ toolCallId: 'tc_5', input: {}, output: { rows: [1, 2, 3] } })
    expect(modelOutput).toEqual({ type: 'text', value: '3 rows' })
    expect(hooks.onToolEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: 'tc_5',
        result: { rows: [1, 2, 3] },
        modelOutput: { type: 'text', value: '3 rows' },
      }),
    )
  })

  it('cleans pending state when toModelOutput throws, reporting the error once', async () => {
    const hooks = registerHooks()
    let calls = 0
    const tools = instrumentToolSet({
      flaky: {
        execute: async () => 'raw',
        toModelOutput: async (): Promise<ToolModelOutput> => {
          calls++
          if (calls === 1) throw new Error('shape failed')
          return { type: 'text', value: 'recovered' }
        },
      },
    })!
    const tool = tools.flaky as {
      execute: (i: unknown, o: object) => Promise<unknown>
      toModelOutput: (a: { toolCallId: string; input: unknown; output: unknown }) => Promise<ToolModelOutput>
    }

    await tool.execute({}, { toolCallId: 'tc_6' })
    await expect(tool.toModelOutput({ toolCallId: 'tc_6', input: {}, output: 'raw' })).rejects.toThrow('shape failed')
    expect(hooks.onToolEnd).toHaveBeenCalledWith(
      expect.objectContaining({ toolCallId: 'tc_6', modelOutputError: 'shape failed' }),
    )

    // Pending entry was cleaned up — a later call for the same id still works
    // (falls back to the args payload rather than stale pending state).
    const recovered = await tool.toModelOutput({ toolCallId: 'tc_6', input: {}, output: 'raw' })
    expect(recovered).toEqual({ type: 'text', value: 'recovered' })
    expect(hooks.onToolEnd).toHaveBeenCalledTimes(2)
  })

  it('evicts the oldest pending entry beyond maxPending instead of leaking', async () => {
    const hooks = registerHooks()
    const tools = instrumentToolSet(
      {
        shaped: {
          execute: async () => 'payload',
          toModelOutput: async (): Promise<ToolModelOutput> => ({ type: 'text', value: 'shaped' }),
        },
      },
      { maxPending: 2 },
    )!
    const tool = tools.shaped as {
      execute: (i: unknown, o: object) => Promise<unknown>
      toModelOutput: (a: { toolCallId: string; input: unknown; output: unknown }) => Promise<ToolModelOutput>
    }

    await tool.execute({}, { toolCallId: 'tc_a' })
    await tool.execute({}, { toolCallId: 'tc_b' })
    await tool.execute({}, { toolCallId: 'tc_c' }) // evicts tc_a

    // The evicted call still completes via the args fallback.
    const out = await tool.toModelOutput({ toolCallId: 'tc_a', input: {}, output: 'from-args' })
    expect(out).toEqual({ type: 'text', value: 'shaped' })
    expect(hooks.onToolEnd).toHaveBeenCalledWith(expect.objectContaining({ toolCallId: 'tc_a', result: 'from-args' }))
  })
})

describe('renderToolModelOutput', () => {
  it('renders text, json, and denial outputs', () => {
    expect(renderToolModelOutput({ type: 'text', value: 'hi' })).toBe('hi')
    expect(renderToolModelOutput({ type: 'json', value: { a: 1 } })).toBe('{"a":1}')
    expect(renderToolModelOutput({ type: 'execution-denied', reason: 'nope' })).toBe('Tool execution denied: nope')
  })
})
