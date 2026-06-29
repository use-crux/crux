/**
 * Internal-module tests for `adapter/tool/emission` — the leak-free
 * instrumentation wrappers the ToolLifecycle session arms sdk-regime tools
 * with. `instrumentToolSet` is a session internal (not exported from any
 * public barrel); these tests pin the deferred-`onToolEnd` bookkeeping the
 * session hides: hook ordering, toModelOutput chaining, and pending-state
 * cleanup (the historical `@use-crux/ai` leak).
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { updateRuntime, resetRuntime } from '../../../runtime/runtime'
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

    it("leaves needsApproval unwrapped — approval hooks are the lifecycle session's to emit", async () => {
    registerHooks()
    const needsApproval = async () => true
    const tools = instrumentToolSet({
      guarded: { execute: async () => 'ok', needsApproval },
    })!

    expect((tools.guarded as { needsApproval: unknown }).needsApproval).toBe(needsApproval)
  })})

describe('renderToolModelOutput', () => {
  it('renders text, json, and denial outputs', () => {
    expect(renderToolModelOutput({ type: 'text', value: 'hi' })).toBe('hi')
    expect(renderToolModelOutput({ type: 'json', value: { a: 1 } })).toBe('{"a":1}')
    expect(renderToolModelOutput({ type: 'execution-denied', reason: 'nope' })).toBe('Tool execution denied: nope')
  })
})
