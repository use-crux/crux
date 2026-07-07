/**
 * Internal-module tests for `adapter/tool/emission` — the leak-free
 * instrumentation wrappers the ToolLifecycle session arms sdk-regime tools
 * with. `instrumentToolSet` is a session internal; these tests pin wrapper
 * behavior that must remain true when the canonical graph spine is active.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { resetHooks } from '../../../runtime/runtime'
import { resetObservabilityRuntime } from '../../../observability'
import { instrumentToolSet, renderToolModelOutput } from '../../../adapter/tool/emission'
import type { ToolModelOutput } from '../../../types/tool'

afterEach(() => {
  resetHooks()
  resetObservabilityRuntime()
})

describe('instrumentToolSet', () => {
  it('returns tools unchanged when no observability sink is registered', () => {
    const tools = { echo: { description: 'echo', execute: async (input: unknown) => input } }
    expect(instrumentToolSet(tools)).toBe(tools)
  })

})

describe('renderToolModelOutput', () => {
  it('renders text, json, and denial outputs', () => {
    expect(renderToolModelOutput({ type: 'text', value: 'hi' })).toBe('hi')
    expect(renderToolModelOutput({ type: 'json', value: { a: 1 } })).toBe('{"a":1}')
    expect(renderToolModelOutput({ type: 'execution-denied', reason: 'nope' })).toBe('Tool execution denied: nope')
  })
})
