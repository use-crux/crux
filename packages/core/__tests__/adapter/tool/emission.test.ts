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
import { guardToolModelOutput } from '../../../src/adapter/tool/model-ingress'
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
        { type: 'image', source: new Uint8Array([1, 2, 3]), mediaType: 'image/png' },
      ],
    })

    expect(text).toBe('Chart captured.\n[image image/png 3B sha256:039058c6f2c0]')
    expect(text).not.toContain('AQID')
  })
})

describe('guardToolModelOutput', () => {
  it('guards and writes back canonical text with semantic tool origin', async () => {
    const output = { type: 'text' as const, value: 'secret', providerOptions: { test: { enabled: true } } }
    const guarded = await guardToolModelOutput({
      output,
      toolName: 'lookup',
      toolCallId: 'call-1',
      guard: async (input) => {
        expect(input).toEqual({
          kind: 'text',
          value: 'secret',
          origin: {
            source: 'tool',
            kind: 'tool-result',
            toolName: 'lookup',
            toolCallId: 'call-1',
          },
        })
        return { kind: 'text', value: '[redacted]' }
      },
    })

    expect(guarded).toEqual({ ...output, value: '[redacted]' })
  })

  it('preserves the error-text variant when canonical text is rewritten', async () => {
    const output = { type: 'error-text' as const, value: 'private failure' }
    const guarded = await guardToolModelOutput({
      output,
      toolName: 'lookup',
      guard: async () => ({ kind: 'text', value: 'safe failure' }),
    })

    expect(guarded).toEqual({ type: 'error-text', value: 'safe failure' })
  })

  it('guards the deterministic JSON rendering and preserves unchanged canonical JSON identity', async () => {
    const output = Object.freeze({ type: 'json' as const, value: Object.freeze({ a: 1 }) })
    let evaluated = false
    const guarded = await guardToolModelOutput({
      output,
      toolName: 'lookup',
      guard: async (input) => {
        evaluated = true
        expect(input).toMatchObject({ kind: 'text', value: '{"a":1}' })
        return { kind: 'text', value: input.value }
      },
    })

    expect(evaluated).toBe(true)
    expect(guarded).toBe(output)
  })

  it('converts rewritten JSON to exact canonical text', async () => {
    const providerOptions = { test: { enabled: true } } as const
    const guarded = await guardToolModelOutput({
      output: { type: 'json', value: { secret: true }, providerOptions },
      toolName: 'lookup',
      guard: async () => ({ kind: 'text', value: 'exact rewrite' }),
    })

    expect(guarded).toEqual({ type: 'text', value: 'exact rewrite', providerOptions })
  })

  it('converts rewritten error JSON to exact error text', async () => {
    const guarded = await guardToolModelOutput({
      output: { type: 'error-json', value: { error: 'private' } },
      toolName: 'lookup',
      guard: async () => ({ kind: 'text', value: 'safe error' }),
    })

    expect(guarded).toEqual({ type: 'error-text', value: 'safe error' })
  })

  it('skips Core-authored execution denials and preserves no-hook identity', async () => {
    const denial = { type: 'execution-denied' as const, reason: 'not approved' }
    let evaluated = false
    const guardedDenial = await guardToolModelOutput({
      output: denial,
      toolName: 'lookup',
      guard: async () => {
        evaluated = true
        return { kind: 'text', value: 'unexpected' }
      },
    })
    const text = { type: 'text' as const, value: 'unchanged' }

    expect(guardedDenial).toBe(denial)
    expect(evaluated).toBe(false)
    await expect(guardToolModelOutput({ output: text, toolName: 'lookup' })).resolves.toBe(text)
  })
})
