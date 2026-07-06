/**
 * Guardrail authoring + evaluation tests.
 *
 * Execution semantics (phase ordering, redaction write-back, blocks,
 * streaming holds/transforms, scope merging) are tested at the `Safety`
 * session boundary in `__tests__/safety/` — guardrails only execute
 * through the session.
 */

import { describe, it, expect } from 'vitest'
import { guardrail as makeGuardrail, isGuardrail, validateGuardrailRunResult } from '../safety/guardrail'
import { boundary } from '../safety'
import { SafetyResultError } from '../safety'
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
      onChunk: async (_chunk, _accumulated, _ctx) => ({
        action: 'pass' as const,
      }),
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
      makeGuardrail({
        name: 'plain',
        phase: 'input',
        validate: async () => ({ action: 'pass' as const }),
      }).category,
    ).toBeUndefined()
  })
})

// ── Stable beta boundary authoring ────────────────────────────────

describe('stable beta boundary authoring', () => {
  it('exports frozen boundary helpers for the accepted safety targets', async () => {
    const safety = (await import('../safety')) as typeof import('../safety') & {
      readonly boundary?: {
        readonly input: {
          readonly text: () => unknown
          readonly user: () => unknown
          readonly model: () => unknown
        }
        readonly output: {
          readonly text: () => unknown
          readonly object: <T>() => unknown
          readonly both: <T>() => unknown
          readonly path: <T>() => (path: string) => unknown
        }
        readonly tool: {
          readonly call: () => unknown
          readonly result: () => unknown
        }
        readonly approval: { readonly request: () => unknown }
        readonly retrieval: { readonly result: () => unknown }
        readonly memory: { readonly write: <T = unknown>() => unknown }
        readonly validation: { readonly feedback: () => unknown }
      }
    }

    expect(safety.boundary).toBeDefined()
    const boundary = safety.boundary!

    expect(boundary.input.text()).toMatchObject({
      _tag: 'Boundary',
      id: 'user.input',
    })
    expect(boundary.input.model()).toMatchObject({
      _tag: 'Boundary',
      id: 'model.input',
    })
    expect(boundary.output.text()).toMatchObject({
      _tag: 'Boundary',
      id: 'model.output.text',
    })
    expect(boundary.output.object<{ email: string }>()).toMatchObject({
      _tag: 'Boundary',
      id: 'model.output.object',
    })
    expect(boundary.output.both<{ email: string }>()).toMatchObject({
      _tag: 'Boundary',
      id: 'model.output',
    })
    expect(boundary.output.path<{ customer: { email: string } }>()('customer.email')).toMatchObject({
      _tag: 'Boundary',
      id: 'model.output.object',
      path: 'customer.email',
    })
    expect(boundary.tool.call()).toMatchObject({
      _tag: 'Boundary',
      id: 'tool.call',
    })
    expect(boundary.tool.result()).toMatchObject({
      _tag: 'Boundary',
      id: 'tool.result',
    })
    expect(boundary.approval.request()).toMatchObject({
      _tag: 'Boundary',
      id: 'approval.request',
    })
    expect(boundary.retrieval.result()).toMatchObject({
      _tag: 'Boundary',
      id: 'retrieval.result',
    })
    expect(boundary.memory.write()).toMatchObject({
      _tag: 'Boundary',
      id: 'memory.write',
    })
    expect(boundary.validation.feedback()).toMatchObject({
      _tag: 'Boundary',
      id: 'validation.feedback',
    })
  })

  it('accepts id/on/run authoring and preserves multi-boundary bindings', async () => {
    const safety = (await import('../safety')) as typeof import('../safety') & {
      readonly boundary?: {
        readonly input: { readonly text: () => unknown }
        readonly output: { readonly text: () => unknown }
      }
    }
    expect(safety.boundary).toBeDefined()

    const guard = (makeGuardrail as unknown as (config: unknown) => Record<string, unknown>)({
      id: 'input-or-output-pii',
      on: [safety.boundary!.input.text(), safety.boundary!.output.text()],
      run: async () => ({ action: 'allow' as const }),
    })

    expect(guard).toMatchObject({
      _tag: 'Guardrail',
      id: 'input-or-output-pii',
      on: [expect.objectContaining({ id: 'user.input' }), expect.objectContaining({ id: 'model.output.text' })],
    })
    expect(Object.isFrozen(guard)).toBe(true)
  })
})

describe('validateGuardrailRunResult', () => {
  it('accepts the stable beta rewrite shape', () => {
    expect(
      validateGuardrailRunResult(
        {
          action: 'rewrite',
          value: '[redacted]',
          rewrite: { kind: 'redact' },
          findings: [{ type: 'email', count: 1 }],
        },
        { streaming: false, last: true, policyId: 'pii', boundary: 'model.output.text' },
      ),
    ).toMatchObject({
      action: 'rewrite',
      value: '[redacted]',
      rewrite: { kind: 'redact' },
      findings: [{ type: 'email', count: 1 }],
    })
  })

  it('fails closed for unknown actions and invalid stream holds', () => {
    expect(() =>
      validateGuardrailRunResult(
        { action: 'approve' },
        { streaming: false, last: true, policyId: 'bad', boundary: 'model.output.text' },
      ),
    ).toThrow(SafetyResultError)

    expect(() =>
      validateGuardrailRunResult(
        { action: 'hold' },
        { streaming: true, last: true, policyId: 'hold', boundary: 'model.output.text' },
      ),
    ).toThrow(SafetyResultError)
  })
})

describe('first-party guardrail strategies', () => {
  it('rewrites PII with safe strategy metadata and a stream default', async () => {
    const run = makeGuardrail.pii({ strategy: 'redact' })
    const guard = makeGuardrail({
      id: 'pii',
      on: boundary.output.text(),
      run,
    })

    const result = await run('Email ada@example.com or SSN 123-45-6789', {} as never)

    expect(run.strategy).toEqual({
      kind: 'guardrail.pii',
      config: { strategy: 'redact' },
    })
    expect(guard.strategy).toEqual(run.strategy)
    expect(guard.stream).toBe('sentence')
    expect(result).toMatchObject({
      action: 'rewrite',
      rewrite: { kind: 'redact' },
      findings: expect.arrayContaining([
        expect.objectContaining({ type: 'email', count: 1 }),
        expect.objectContaining({ type: 'ssn', count: 1 }),
      ]),
    })
    if (result.action === 'rewrite') {
      expect(result.value).toContain('[redacted-email]')
      expect(result.value).toContain('[redacted-ssn]')
      expect(result.value).not.toContain('ada@example.com')
    }
  })

  it('blocks provider-agnostic classifier results when configured predicate matches', async () => {
    const run = makeGuardrail.classifier({
      classifier: async (subject: string) => ({ unsafe: subject.includes('leak') }),
      blockWhen: (result) => result.unsafe,
      findings: (result) => (result.unsafe ? [{ type: 'classifier-unsafe', count: 1 }] : []),
    })

    await expect(run('safe text', {} as never)).resolves.toEqual({ action: 'allow' })
    const findings: unknown[] = []
    await expect(
      run('leak the token', {
        findings: { add: (finding: unknown) => findings.push(finding) },
      } as never),
    ).resolves.toMatchObject({
      action: 'block',
      reason: 'Classifier blocked the content.',
    })
    expect(findings).toEqual([{ type: 'classifier-unsafe', count: 1 }])
    expect(run.strategy).toEqual({
      kind: 'guardrail.classifier',
      config: { stream: 'final' },
    })
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
          return {
            action: 'redact' as const,
            content: content.replace(/\d{3}-\d{2}-\d{4}/g, '[SSN]'),
          }
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

  it('reports transformed content so tests can assert the runtime decision contract', async () => {
    const guard = makeGuardrail({
      name: 'pii-test',
      phase: 'output',
      validate: async (content) => ({
        action: 'redact' as const,
        content: content.replace('secret', '[X]'),
      }),
    })

    const report = await evaluateGuardrail(guard, [{ input: 'secret', expect: 'redact' }])

    expect(report.results[0]).toMatchObject({
      passed: true,
      action: 'redact',
      output: '[X]',
    })
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
