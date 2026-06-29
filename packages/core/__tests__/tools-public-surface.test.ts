/**
 * Public-surface characterization for the Phase 6 tools + shared move.
 *
 * Every subject under test is imported through the PACKAGE SPECIFIER
 * (`@use-crux/core`, `@use-crux/core/tools`, `@use-crux/core/tool-middleware`),
 * never a relative path. That is what makes this suite immune to the
 * internal file moves performed in Phase 6 (tools/ + shared/ domains, root
 * compatibility shims): the assertions only break if a public export is
 * removed, renamed, or mistyped — not when implementation files move.
 */

import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { tool } from '@use-crux/core/tools'
import {
  toolMiddleware,
  approvalMiddleware,
  toolApprovalResponse,
  appendToolApprovalResponse,
  findToolApprovalRequests,
  findToolApprovalDecision,
  deniedToolModelOutput,
} from '@use-crux/core/tool-middleware'
import {
  composeTools,
  countTokens,
  setTokenizer,
  escapeXml,
  truncate,
  userContent,
  safe,
  raw,
  limit,
  wrap,
  sanitizeJsonSchema,
} from '@use-crux/core'

// ─────────────────────────────────────────────────────────────────
// tools/ — tool() authoring (subpath: @use-crux/core/tools)
// ─────────────────────────────────────────────────────────────────

describe('@use-crux/core/tools — tool()', () => {
  it('builds a frozen, runnable definition and preserves a literal name', async () => {
    const search = tool({
      name: 'search',
      description: 'Search the docs',
      input: z.object({ query: z.string() }),
      execute: ({ query }) => `results for ${query}`,
    })

    expect(search.name).toBe('search')
    expect(search.description).toBe('Search the docs')
    expect(Object.isFrozen(search)).toBe(true)
    expect(await search.execute({ query: 'crux' })).toBe('results for crux')
  })

    it('defaults to an empty input schema when none is provided', async () => {
    const ping = tool({ description: 'no input', execute: () => 'pong' })
    expect(await ping.execute({})).toBe('pong')
  })
})

// ─────────────────────────────────────────────────────────────────
// tools/ — middleware + approval protocol (subpath: /tool-middleware)
// ─────────────────────────────────────────────────────────────────

describe('@use-crux/core/tool-middleware — middleware', () => {
  it('aroundExecute wraps the original execute', async () => {
    const seen: string[] = []
    const mw = toolMiddleware({
      id: 'log',
      aroundExecute: (call, next) => {
        seen.push(call.toolName)
        return next(call.input, call.options)
      },
    })

    expect(mw._tag).toBe('ToolMiddleware')

    const wrapped = mw.wrapTool('echo', { execute: async (input: { v: string }) => input.v })
    const out = await wrapped.execute?.({ v: 'hi' }, {})

    expect(out).toBe('hi')
    expect(seen).toEqual(['echo'])
  })

    it('approvalMiddleware forces approval for matched tools', async () => {
    const mw = approvalMiddleware({ id: 'gate', match: ['danger'] })
    const wrapped = mw.wrapTool('danger', { execute: async () => 'ok' })
    expect(await wrapped.needsApproval?.({}, {})).toBe(true)
  })
})

describe('@use-crux/core/tool-middleware — approval protocol helpers', () => {
  it('round-trips an approval request → decision through messages', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'tool-approval-request', approvalId: 'a1', toolCallId: 'c1', toolName: 'danger', input: { x: 1 } },
        ],
      },
    ]

    const requests = findToolApprovalRequests(messages)
    expect(requests).toHaveLength(1)
    expect(requests[0]?.approvalId).toBe('a1')
    expect(requests[0]?.toolName).toBe('danger')

    const withResponse = appendToolApprovalResponse(messages, { approvalId: 'a1', approved: true })
    const decision = findToolApprovalDecision(withResponse, 'a1')
    expect(decision?.approved).toBe(true)
  })

    it('toolApprovalResponse + deniedToolModelOutput build canonical parts', () => {
    expect(toolApprovalResponse({ approvalId: 'a1', approved: false, reason: 'no' })).toEqual({
      type: 'tool-approval-response',
      approvalId: 'a1',
      approved: false,
      reason: 'no',
    })
    expect(deniedToolModelOutput('blocked')).toEqual({ type: 'execution-denied', reason: 'blocked' })
  })
})

// ─────────────────────────────────────────────────────────────────
// tools/entity — composeTools (root barrel)
// ─────────────────────────────────────────────────────────────────

describe('@use-crux/core — composeTools', () => {
  it('merges disjoint tool sets and throws on name collision', () => {
    const a = { search: tool({ description: 'a', execute: () => 'a' }) }
    const b = { lookup: tool({ description: 'b', execute: () => 'b' }) }

    expect(Object.keys(composeTools(a, b)).sort()).toEqual(['lookup', 'search'])
    expect(() => composeTools(a, a)).toThrow(/collision/)
  })
})

// ─────────────────────────────────────────────────────────────────
// shared/tokenizer — pluggable token counting (root barrel)
// ─────────────────────────────────────────────────────────────────

describe('@use-crux/core — tokenizer', () => {
  it('counts with the default chars/4 estimator and honors setTokenizer', () => {
    // `defaultTokenizer` is intentionally not part of the public root surface,
    // so restore the chars/4 default behavior explicitly after mutating.
    expect(countTokens('abcd')).toBe(1)
    try {
      setTokenizer((text) => text.length)
      expect(countTokens('abc')).toBe(3)
    } finally {
      setTokenizer((text) => Math.ceil(text.length / 4))
    }
    expect(countTokens('abcd')).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────
// shared/sanitize — injection-defense helpers (root barrel)
// ─────────────────────────────────────────────────────────────────

describe('@use-crux/core — sanitize', () => {
  it('escapes structure-breaking characters and composes inside safe``', () => {
    expect(escapeXml('<a>')).toBe('&lt;a&gt;')
    expect(safe`x=${'<b>'}`).toBe('x=&lt;b&gt;')
    expect(safe`x=${raw('<b>')}`).toBe('x=<b>')
    expect(safe`q=${limit('abcdef', 4)}`).toBe('q=abc…')
    expect(safe`i=${wrap('a<b>')}`).toBe('i=<user-input>a&lt;b&gt;</user-input>')
    expect(truncate('abcdef', 4)).toBe('abc…')
    expect(userContent('a<b>')).toBe('<user-input>a&lt;b&gt;</user-input>')
  })
})

// ─────────────────────────────────────────────────────────────────
// shared/schema-compat — provider schema sanitization (root @internal)
// ─────────────────────────────────────────────────────────────────

describe('@use-crux/core — sanitizeJsonSchema', () => {
  it('strips Anthropic-unsupported keys and passes other providers through', () => {
    const schema = { type: 'array', maxItems: 3, items: { type: 'string', minLength: 1 } }

    expect(sanitizeJsonSchema(schema, 'anthropic')).toEqual({
      type: 'array',
      items: { type: 'string' },
    })
    expect(sanitizeJsonSchema(schema, 'openai')).toBe(schema)
  })
})
