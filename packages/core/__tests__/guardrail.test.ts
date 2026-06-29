/**
 * Guardrail authoring + evaluation tests.
 *
 * Execution semantics (phase ordering, redaction write-back, blocks,
 * streaming holds/transforms, scope merging) are tested at the `Safety`
 * session boundary in `__tests__/safety/` — guardrails only execute
 * through the session.
 */

import { describe, it, expect } from 'vitest'
import { guardrail as makeGuardrail, isGuardrail } from '../safety/guardrail'
import { evaluateGuardrail } from '../safety/guardrail/evaluate'
import type { GuardrailContext } from '../safety/guardrail'

describe('guardrail', () => {
  it('creates a frozen guardrail object with correct shape', () => {
    const guard = makeGuardrail({
      name: 'test-guard',
      phase: 'input',
      validate: async (content: string, _ctx: GuardrailContext) => {
        if (content.includes('bad')) return { action: 'block' as const, reason: 'Contains bad word' }
        return { action: 'pass' as const }
      },
    })

    expect(guard._tag).toBe('Guardrail')
    expect(guard.name).toBe('test-guard')
    expect(guard.phase).toBe('input')
    expect(typeof guard.validate).toBe('function')
    expect(Object.isFrozen(guard)).toBe(true)
  })

  it('infers phase from config — input guard cannot return reask', () => {
    // This test verifies the runtime shape. TypeScript compile-time enforcement
    // is tested by the type system itself (reask not in InputGuardrailResult).
    const guard = makeGuardrail({
      name: 'input-only',
      phase: 'input',
      validate: async () => ({ action: 'pass' as const }),
    })

    expect(guard.phase).toBe('input')
  })

  it('creates output guard with all action types except reask', () => {
    const guard = makeGuardrail({
      name: 'output-filter',
      phase: 'output',
      validate: async (content: string) => {
        if (content.includes('toxic')) return { action: 'block' as const, reason: 'Toxic content' }
        return { action: 'pass' as const }
      },
    })

    expect(guard.phase).toBe('output')
    expect(Object.isFrozen(guard)).toBe(true)
  })

  it('supports stream config on output guards', () => {
    const guard = makeGuardrail({
      name: 'streaming-guard',
      phase: 'output',
      stream: { buffer: 'full' },
      validate: async () => ({ action: 'pass' as const }),
    })

    expect(guard.stream).toEqual({ buffer: 'full' })
  })

  it('supports onChunk handler for streaming', () => {
    const guard = makeGuardrail({
      name: 'chunk-guard',
      phase: 'output',
      stream: { buffer: 'none' },
      onChunk: async (_chunk, _accumulated, _ctx) => ({ action: 'pass' as const }),
      validate: async () => ({ action: 'pass' as const }),
    })

    expect(typeof guard.onChunk).toBe('function')
  })

  it('carries an optional risk category', () => {
    const guard = makeGuardrail({
      name: 'pii-guard',
      category: 'pii',
      phase: 'input',
      validate: async () => ({ action: 'pass' as const }),
    })

    expect(guard.category).toBe('pii')
    expect(
      makeGuardrail({ name: 'plain', phase: 'input', validate: async () => ({ action: 'pass' as const }) }).category,
    ).toBeUndefined()
  })
})

describe('isGuardrail', () => {
  it('returns true for guardrail objects', () => {
    const guard = makeGuardrail({
      name: 'test',
      phase: 'input',
      validate: async () => ({ action: 'pass' as const }),
    })

    expect(isGuardrail(guard)).toBe(true)
  })

  it('returns false for non-guardrail objects', () => {
    expect(isGuardrail(null)).toBe(false)
    expect(isGuardrail(undefined)).toBe(false)
    expect(isGuardrail({})).toBe(false)
    expect(isGuardrail({ _tag: 'Prompt' })).toBe(false)
    expect(isGuardrail('string')).toBe(false)
  })
})

// ── Scoping: per-context guardrails ───────────────────────────────

describe('context-level guardrails', () => {
  it('context() stores guardrails on frozen object', async () => {
    // Dynamic import to avoid circular issues in test
    const { context } = await import('../prompt/context')

    const guard = makeGuardrail({
      name: 'ctx-guard',
      phase: 'input',
      validate: async () => ({ action: 'pass' as const }),
    })

    const ctx = context({
      system: 'Test context',
      guardrails: [guard],
    })

    expect(ctx.guardrails).toHaveLength(1)
    expect(ctx.guardrails[0]!.name).toBe('ctx-guard')
    expect(Object.isFrozen(ctx.guardrails)).toBe(true)
  })

  it('context() defaults to empty guardrails array', async () => {
    const { context } = await import('../prompt/context')

    const ctx = context({
      system: 'No guards',
    })

    expect(ctx.guardrails).toHaveLength(0)
  })
})

// ── evaluateGuardrail() testing helper ──────────────────────────────

describe('evaluateGuardrail', () => {
  it('runs a guard against test cases and returns pass/fail', async () => {
    const guard = makeGuardrail({
      name: 'pii-test',
      phase: 'output',
      validate: async (content) => {
        if (/\d{3}-\d{2}-\d{4}/.test(content))
          return { action: 'redact' as const, content: content.replace(/\d{3}-\d{2}-\d{4}/g, '[SSN]') }
        return { action: 'pass' as const }
      },
    })

    const report = await evaluateGuardrail(guard, [
      { input: 'SSN is 123-45-6789', expect: 'redact' },
      { input: 'Hello world', expect: 'pass' },
      { input: 'Call 555-12-3456', expect: 'redact' },
    ])

    expect(report.results).toHaveLength(3)
    expect(report.results[0]!.passed).toBe(true)
    expect(report.results[0]!.action).toBe('redact')
    expect(report.results[1]!.passed).toBe(true)
    expect(report.results[1]!.action).toBe('pass')
    expect(report.results[2]!.passed).toBe(true)
    expect(report.results[2]!.action).toBe('redact')
    expect(report.summary.total).toBe(3)
    expect(report.summary.passed).toBe(3)
    expect(report.summary.failed).toBe(0)
  })

  it('reports failures when action does not match expectation', async () => {
    const guard = makeGuardrail({
      name: 'always-pass',
      phase: 'output',
      validate: async () => ({ action: 'pass' as const }),
    })

    const report = await evaluateGuardrail(guard, [{ input: 'anything', expect: 'block' }])

    expect(report.results[0]!.passed).toBe(false)
    expect(report.results[0]!.action).toBe('pass')
    expect(report.results[0]!.expected).toBe('block')
    expect(report.summary.passed).toBe(0)
    expect(report.summary.failed).toBe(1)
  })

  it('handles guard errors gracefully', async () => {
    const guard = makeGuardrail({
      name: 'broken',
      phase: 'output',
      validate: async () => {
        throw new Error('Guard exploded')
      },
    })

    const report = await evaluateGuardrail(guard, [{ input: 'test', expect: 'pass' }])

    expect(report.results[0]!.passed).toBe(false)
    expect(report.results[0]!.error).toBe('Guard exploded')
    expect(report.summary.failed).toBe(1)
  })
})
