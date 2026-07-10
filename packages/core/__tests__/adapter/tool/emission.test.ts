/**
 * Internal-module tests for `adapter/tool/emission` — the leak-free
 * instrumentation wrappers the ToolLifecycle session arms sdk-regime tools
 * with. `instrumentToolSet` is a session internal; these tests pin wrapper
 * behavior that must remain true when the canonical graph spine is active.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { resetHooks } from '../../../src/runtime/runtime'
import { resetObservabilityRuntime } from '../../../src/observability'
import { instrumentToolSet, renderToolModelOutput } from '../../../src/adapter/tool/emission'
import type { ToolModelOutput } from '../../../src/types/tool'

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

  it('renders rich content outputs through bounded placeholders instead of raw base64', () => {
    const text = renderToolModelOutput({
      type: 'content',
      value: [
        { type: 'text', text: 'Chart captured.' },
        { type: 'image-data', data: 'AQID', mediaType: 'image/png' },
      ],
    })

    expect(text).toBe('Chart captured.\n[image image/png 3B sha256:039058c6f2c0]')
    expect(text).not.toContain('AQID')
  })
})
