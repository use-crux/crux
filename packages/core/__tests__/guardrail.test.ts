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

describe('guardrail', () => {
  it('creates a frozen guardrail object with correct shape', () => {
    const guard = makeGuardrail({
      id: 'test-guard',
      on: boundary.input.text(),
      run: async (content: string) => {
        if (content.includes('bad')) return { action: 'block' as const, reason: 'Contains bad word' }
        return { action: 'allow' as const }
      },
    })

    expect(guard._tag).toBe('Guardrail')
    expect(guard.id).toBe('test-guard')
    expect(guard.on).toMatchObject({ id: 'user.input' })
    expect(typeof guard.run).toBe('function')
    expect(Object.isFrozen(guard)).toBe(true)
  })

  it('binds input guards to the accepted user-input boundary', () => {
    // This test verifies the runtime shape. TypeScript compile-time enforcement
    // is tested by the type system itself.
    const guard = makeGuardrail({
      id: 'input-only',
      on: boundary.input.text(),
      run: async () => ({ action: 'allow' as const }),
    })

    expect(guard.on).toMatchObject({ id: 'user.input' })
  })

  it('creates output guard with the accepted action vocabulary', () => {
    const guard = makeGuardrail({
      id: 'output-filter',
      on: boundary.output.text(),
      run: async (content: string) => {
        if (content.includes('toxic')) return { action: 'block' as const, reason: 'Toxic content' }
        return { action: 'allow' as const }
      },
    })

    expect(guard.on).toMatchObject({ id: 'model.output.text' })
    expect(Object.isFrozen(guard)).toBe(true)
  })

  it('supports stream config on output guards', () => {
    const guard = makeGuardrail({
      id: 'streaming-guard',
      on: boundary.output.text(),
      stream: 'final',
      run: async () => ({ action: 'allow' as const }),
    })

    expect(guard.stream).toBe('final')
  })

  it('supports explicit chunk segmentation for streaming', () => {
    const guard = makeGuardrail({
      id: 'chunk-guard',
      on: boundary.output.text(),
      stream: 'chunk',
      run: async () => ({ action: 'allow' as const }),
    })

    expect(guard.stream).toBe('chunk')
  })

  it('carries an optional risk category', () => {
    const guard = makeGuardrail({
      id: 'pii-guard',
      on: boundary.input.text(),
      category: 'pii',
      run: async () => ({ action: 'allow' as const }),
    })

    expect(guard.category).toBe('pii')
    expect(
      makeGuardrail({
        id: 'plain',
        on: boundary.input.text(),
        run: async () => ({ action: 'allow' as const }),
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
      id: 'test',
      on: boundary.input.text(),
      run: async () => ({ action: 'allow' as const }),
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
      id: 'ctx-guard',
      on: boundary.input.text(),
      run: async () => ({ action: 'allow' as const }),
    })

    const ctx = context({
      system: 'Test context',
      guardrails: [guard],
    })

    expect(ctx.guardrails).toHaveLength(1)
    expect(ctx.guardrails[0]!.id).toBe('ctx-guard')
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
      id: 'pii-test',
      on: boundary.output.text(),
      run: async (content) => {
        if (/\d{3}-\d{2}-\d{4}/.test(content))
          return {
            action: 'rewrite' as const,
            value: content.replace(/\d{3}-\d{2}-\d{4}/g, '[SSN]'),
            rewrite: { kind: 'redact' as const },
          }
        return { action: 'allow' as const }
      },
    })

    const report = await evaluateGuardrail(guard, [
      { input: 'SSN is 123-45-6789', expect: 'rewrite' },
      { input: 'Hello world', expect: 'allow' },
      { input: 'Call 555-12-3456', expect: 'rewrite' },
    ])

    expect(report.results).toHaveLength(3)
    expect(report.results[0]!.passed).toBe(true)
    expect(report.results[0]!.action).toBe('rewrite')
    expect(report.results[1]!.passed).toBe(true)
    expect(report.results[1]!.action).toBe('allow')
    expect(report.results[2]!.passed).toBe(true)
    expect(report.results[2]!.action).toBe('rewrite')
    expect(report.summary.total).toBe(3)
    expect(report.summary.passed).toBe(3)
    expect(report.summary.failed).toBe(0)
  })

  it('reports transformed content so tests can assert the runtime decision contract', async () => {
    const guard = makeGuardrail({
      id: 'pii-test',
      on: boundary.output.text(),
      run: async (content) => ({
        action: 'rewrite' as const,
        value: content.replace('secret', '[X]'),
        rewrite: { kind: 'redact' as const },
      }),
    })

    const report = await evaluateGuardrail(guard, [{ input: 'secret', expect: 'rewrite' }])

    expect(report.results[0]).toMatchObject({
      passed: true,
      action: 'rewrite',
      output: '[X]',
    })
  })

  it('reports failures when action does not match expectation', async () => {
    const guard = makeGuardrail({
      id: 'always-allow',
      on: boundary.output.text(),
      run: async () => ({ action: 'allow' as const }),
    })

    const report = await evaluateGuardrail(guard, [{ input: 'anything', expect: 'block' }])

    expect(report.results[0]!.passed).toBe(false)
    expect(report.results[0]!.action).toBe('allow')
    expect(report.results[0]!.expected).toBe('block')
    expect(report.summary.passed).toBe(0)
    expect(report.summary.failed).toBe(1)
  })

  it('handles guard errors gracefully', async () => {
    const guard = makeGuardrail({
      id: 'broken',
      on: boundary.output.text(),
      run: async () => {
        throw new Error('Guard exploded')
      },
    })

    const report = await evaluateGuardrail(guard, [{ input: 'test', expect: 'allow' }])

    expect(report.results[0]!.passed).toBe(false)
    expect(report.results[0]!.error).toBe('Guard exploded')
    expect(report.summary.failed).toBe(1)
  })
})
