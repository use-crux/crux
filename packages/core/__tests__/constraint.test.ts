/**
 * Constraint authoring + evaluation tests.
 *
 * Execution semantics (parallel checks, combined-feedback retries, budgets,
 * assert/suggest separation, audits) are tested at the `Safety` session
 * boundary in `__tests__/safety/` — constraints only execute through the
 * session.
 */

import { describe, it, expect } from 'vitest'
import { constraint as makeConstraint, isConstraint } from '../safety/constraint/define'
import { evaluateConstraint } from '../safety/constraint/evaluate'
import { ConstraintViolationError } from '../safety/constraint/errors'
import type { ConstraintContext } from '../safety/constraint/types'

const makeCtx = (overrides?: Partial<ConstraintContext>): ConstraintContext => ({
  promptId: 'test-prompt',
  model: 'test-model',
  traceId: undefined,
  attempt: 0,
  metadata: {},
  ...overrides,
})

// ── makeConstraint() ────────────────────────────────────────────

describe('constraint', () => {
  it('creates a frozen constraint object with correct shape', () => {
    const constraint = makeConstraint({
      name: 'test',
      check: async () => ({ pass: true }),
    })

    expect(constraint._tag).toBe('Constraint')
    expect(constraint.name).toBe('test')
    expect(constraint.severity).toBe('assert') // default
    expect(constraint.maxRetries).toBe(2) // default
    expect(constraint.onChunk).toBeUndefined()
    expect(Object.isFrozen(constraint)).toBe(true)
  })

  it('respects severity and maxRetries overrides', () => {
    const constraint = makeConstraint({
      name: 'soft',
      severity: 'suggest',
      maxRetries: 5,
      check: async () => ({ pass: true }),
    })

    expect(constraint.severity).toBe('suggest')
    expect(constraint.maxRetries).toBe(5)
  })

  it('includes onChunk when provided', () => {
    const constraint = makeConstraint({
      name: 'streaming',
      check: async () => ({ pass: true }),
      onChunk: async () => ({ abort: false }),
    })

    expect(constraint.onChunk).toBeDefined()
  })

  it('carries an optional risk category', () => {
    const constraint = makeConstraint({
      name: 'grounded',
      category: 'grounding',
      check: async () => ({ pass: true }),
    })

    expect(constraint.category).toBe('grounding')
    expect(makeConstraint({ name: 'plain', check: async () => ({ pass: true }) }).category).toBeUndefined()
  })
})

// ── isConstraint() ────────────────────────────────────────────────

describe('isConstraint', () => {
  it('returns true for constraint objects', () => {
    const constraint = makeConstraint({
      name: 'test',
      check: async () => ({ pass: true }),
    })
    expect(isConstraint(constraint)).toBe(true)
  })

  it('returns false for non-constraint objects', () => {
    expect(isConstraint(null)).toBe(false)
    expect(isConstraint(undefined)).toBe(false)
    expect(isConstraint({})).toBe(false)
    expect(isConstraint({ _tag: 'Guardrail' })).toBe(false)
    expect(isConstraint('string')).toBe(false)
  })
})

// ── evaluateConstraint() testing helper ───────────────────────────

describe('evaluateConstraint', () => {
  it('runs constraint against test cases', async () => {
    const c = makeConstraint({
      name: 'citation-check',
      check: async (output) => {
        if (output.text.includes('[1]')) return { pass: true }
        return { pass: false, feedback: 'Missing citation' }
      },
    })

    const report = await evaluateConstraint(c, [
      { input: { text: 'See [1] for details' }, expect: true },
      { input: { text: 'No citations here' }, expect: false },
      { input: { text: 'Unexpected pass' }, expect: true }, // will fail
    ])

    expect(report.summary.total).toBe(3)
    expect(report.summary.passed).toBe(2) // first two match
    expect(report.summary.failed).toBe(1) // third doesn't match
  })

  it('handles errors in check function', async () => {
    const c = makeConstraint({
      name: 'buggy',
      check: async () => {
        throw new Error('Oops')
      },
    })

    const report = await evaluateConstraint(c, [{ input: { text: 'test' }, expect: true }])

    expect(report.results[0]!.matched).toBe(false)
    expect(report.results[0]!.error).toBe('Oops')
  })

  it('reports constraint metadata so tests can assert the runtime decision contract', async () => {
    const c = makeConstraint({
      name: 'risk-check',
      check: async () => ({
        pass: false,
        feedback: 'Contains risky claim',
        metadata: { risk: 'unsupported-claim' },
      }),
    })

    const report = await evaluateConstraint(c, [{ input: { text: 'risky output' }, expect: false }])

    expect(report.results[0]).toMatchObject({
      matched: true,
      actualPass: false,
      feedback: 'Contains risky claim',
      metadata: { risk: 'unsupported-claim' },
    })
  })
})

// ── ConstraintViolationError ──────────────────────────────────────

describe('ConstraintViolationError', () => {
  it('has correct shape', () => {
    const err = new ConstraintViolationError({
      failedConstraints: [
        { name: 'a', feedback: 'A failed' },
        { name: 'b', feedback: 'B failed' },
      ],
      audit: { entries: [], allPassed: false, suggestFallback: false },
      lastOutput: 'bad output',
      totalAttempts: 3,
    })

    expect(err.name).toBe('ConstraintViolationError')
    expect(err.failedConstraints).toHaveLength(2)
    expect(err.lastOutput).toBe('bad output')
    expect(err.totalAttempts).toBe(3)
    expect(err.message).toContain('a')
    expect(err.message).toContain('b')
    expect(err.message).toContain('3 attempts')
  })
})

// ── Discriminated union type safety ───────────────────────────────

describe('discriminated union check results', () => {
  it('check function returning pass:false requires feedback', async () => {
    // This test verifies runtime behavior — TypeScript compile-time
    // enforcement is the primary guard (feedback is required when pass=false)
    const c = makeConstraint({
      name: 'typed',
      check: async (output) => {
        if (output.text === 'bad') return { pass: false, feedback: 'Must provide feedback' }
        return { pass: true }
      },
    })

    const result = await c.check({ text: 'good', parsed: undefined }, makeCtx())
    expect(result.pass).toBe(true)
  })

  it('onChunk returning abort:true requires feedback', async () => {
    const c = makeConstraint({
      name: 'stream-check',
      check: async () => ({ pass: true }),
      onChunk: async (_chunk, accumulated) => {
        if (accumulated.length > 10) return { abort: true, feedback: 'Too long already' }
        return { abort: false }
      },
    })

    const result = await c.onChunk!('a'.repeat(20), 'a'.repeat(20), makeCtx())
    expect(result.abort).toBe(true)
    if (result.abort) {
      expect(result.feedback).toBe('Too long already')
    }
  })
})
