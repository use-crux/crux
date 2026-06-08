import { describe, it, expect, vi } from 'vitest'
import { constraint as makeConstraint, isConstraint } from '../safety/constraint/define'
import { runConstraints } from '../safety/constraint/runner'
import { evaluateConstraint } from '../safety/constraint/evaluate'
import { ConstraintViolationError } from '../safety/constraint/errors'
import type { ConstraintOutput, ConstraintContext, ConstraintAuditEntry } from '../safety/constraint/types'

// ── Helpers ────────────────────────────────────────────────────────

const makeCtx = (overrides?: Partial<ConstraintContext>): ConstraintContext => ({
  promptId: 'test-prompt',
  model: 'test-model',
  traceId: undefined,
  attempt: 0,
  metadata: {},
  ...overrides,
})

const makeOutput = (text: string, parsed?: unknown): ConstraintOutput => ({
  text,
  parsed,
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

// ── runConstraints() — Basic ──────────────────────────────────────

describe('runConstraints — basic', () => {
  it('returns allPassed when all constraints pass', async () => {
    const c1 = makeConstraint({ name: 'a', check: async () => ({ pass: true }) })
    const c2 = makeConstraint({ name: 'b', check: async () => ({ pass: true }) })

    const result = await runConstraints([c1, c2], makeOutput('hello'), makeCtx(), async () => makeOutput(''))

    expect(result.audit.allPassed).toBe(true)
    expect(result.audit.suggestFallback).toBe(false)
    expect(result.audit.entries).toHaveLength(2)
  })

  it('runs constraints in parallel', async () => {
    const started: number[] = []

    const slow = makeConstraint({
      name: 'slow',
      check: async () => {
        started.push(Date.now())
        await new Promise((r) => setTimeout(r, 50))
        return { pass: true }
      },
    })
    const fast = makeConstraint({
      name: 'fast',
      check: async () => {
        started.push(Date.now())
        return { pass: true }
      },
    })

    await runConstraints([slow, fast], makeOutput('test'), makeCtx(), async () => makeOutput(''))

    // Both should start within a few ms of each other (parallel)
    expect(Math.abs(started[0]! - started[1]!)).toBeLessThan(20)
  })

  it('passes output text and parsed to check function', async () => {
    let receivedOutput: ConstraintOutput | undefined

    const c = makeConstraint({
      name: 'inspector',
      check: async (output) => {
        receivedOutput = output
        return { pass: true }
      },
    })

    await runConstraints([c], makeOutput('hello world', { key: 'value' }), makeCtx(), async () => makeOutput(''))

    expect(receivedOutput!.text).toBe('hello world')
    expect(receivedOutput!.parsed).toEqual({ key: 'value' })
  })
})

// ── runConstraints() — Assert severity ────────────────────────────

describe('runConstraints — assert severity', () => {
  it('throws ConstraintViolationError when assert fails after retries', async () => {
    const c = makeConstraint({
      name: 'strict',
      severity: 'assert',
      maxRetries: 1,
      check: async () => ({ pass: false, feedback: 'Always fails' }),
    })

    await expect(
      runConstraints([c], makeOutput('bad'), makeCtx(), async () => makeOutput('still bad')),
    ).rejects.toThrow(ConstraintViolationError)
  })

  it('error contains all failing constraints', async () => {
    const c1 = makeConstraint({
      name: 'a',
      severity: 'assert',
      maxRetries: 0,
      check: async () => ({ pass: false, feedback: 'A fails' }),
    })
    const c2 = makeConstraint({
      name: 'b',
      severity: 'assert',
      maxRetries: 0,
      check: async () => ({ pass: false, feedback: 'B fails' }),
    })

    try {
      await runConstraints([c1, c2], makeOutput('bad'), makeCtx(), async () => makeOutput('bad'))
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(ConstraintViolationError)
      const violation = err as ConstraintViolationError
      expect(violation.failedConstraints).toHaveLength(2)
      expect(violation.failedConstraints.map((f) => f.name)).toContain('a')
      expect(violation.failedConstraints.map((f) => f.name)).toContain('b')
      expect(violation.totalAttempts).toBe(1)
    }
  })

  it('retries with combined feedback and succeeds', async () => {
    let callCount = 0

    const c = makeConstraint({
      name: 'fixable',
      severity: 'assert',
      maxRetries: 2,
      check: async (output) => {
        callCount++
        if (output.text === 'bad') return { pass: false, feedback: 'Fix it' }
        return { pass: true }
      },
    })

    let regenerateFeedback = ''
    const result = await runConstraints([c], makeOutput('bad'), makeCtx(), async (feedback) => {
      regenerateFeedback = feedback
      return makeOutput('good')
    })

    expect(result.audit.allPassed).toBe(true)
    expect(callCount).toBe(2) // first check fails, second passes
    expect(regenerateFeedback).toContain('[fixable]')
    expect(regenerateFeedback).toContain('Fix it')
  })

  it('combines feedback from multiple failing constraints', async () => {
    const c1 = makeConstraint({
      name: 'cite',
      severity: 'assert',
      maxRetries: 1,
      check: async (output) => {
        if (!output.text.includes('[1]')) return { pass: false, feedback: 'Need citations' }
        return { pass: true }
      },
    })
    const c2 = makeConstraint({
      name: 'lang',
      severity: 'assert',
      maxRetries: 1,
      check: async (output) => {
        if (!output.text.includes('bonjour')) return { pass: false, feedback: 'Must be in French' }
        return { pass: true }
      },
    })

    let feedback = ''
    const result = await runConstraints([c1, c2], makeOutput('hello'), makeCtx(), async (fb) => {
      feedback = fb
      return makeOutput('bonjour [1]')
    })

    expect(result.audit.allPassed).toBe(true)
    expect(feedback).toContain('[cite]')
    expect(feedback).toContain('[lang]')
    expect(feedback).toContain('Need citations')
    expect(feedback).toContain('Must be in French')
  })
})

// ── runConstraints() — Suggest severity ───────────────────────────

describe('runConstraints — suggest severity', () => {
  it('returns last attempt without throwing on suggest failure', async () => {
    const c = makeConstraint({
      name: 'nice-to-have',
      severity: 'suggest',
      maxRetries: 1,
      check: async () => ({ pass: false, feedback: 'Not ideal' }),
    })

    const result = await runConstraints([c], makeOutput('meh'), makeCtx(), async () => makeOutput('still meh'))

    expect(result.audit.allPassed).toBe(false)
    expect(result.audit.suggestFallback).toBe(true)
    expect(result.output.text).toBe('meh') // returns original since suggest doesn't drive retries alone
  })

  it('does not retry for suggest-only failures', async () => {
    let regenerateCalled = false

    const c = makeConstraint({
      name: 'soft',
      severity: 'suggest',
      maxRetries: 3,
      check: async () => ({ pass: false, feedback: 'Soft fail' }),
    })

    await runConstraints([c], makeOutput('text'), makeCtx(), async () => {
      regenerateCalled = true
      return makeOutput('text')
    })

    expect(regenerateCalled).toBe(false) // suggest failures don't trigger retries
  })
})

// ── runConstraints() — Mixed severity ─────────────────────────────

describe('runConstraints — mixed severity', () => {
  it('assert drives retries; suggest tracked in audit', async () => {
    const assertC = makeConstraint({
      name: 'required',
      severity: 'assert',
      maxRetries: 1,
      check: async (output) => {
        if (output.text === 'bad') return { pass: false, feedback: 'Required fix' }
        return { pass: true }
      },
    })
    const suggestC = makeConstraint({
      name: 'optional',
      severity: 'suggest',
      maxRetries: 1,
      check: async () => ({ pass: false, feedback: 'Nice to have' }),
    })

    const result = await runConstraints([assertC, suggestC], makeOutput('bad'), makeCtx(), async () =>
      makeOutput('good'),
    )

    // Assert passed after retry, suggest still fails
    expect(result.audit.suggestFallback).toBe(true)
    // Should not throw since assert passed
  })

  it('throws when any assert fails even if suggest passes', async () => {
    const assertC = makeConstraint({
      name: 'strict',
      severity: 'assert',
      maxRetries: 0,
      check: async () => ({ pass: false, feedback: 'Never passes' }),
    })
    const suggestC = makeConstraint({
      name: 'easy',
      severity: 'suggest',
      check: async () => ({ pass: true }),
    })

    await expect(
      runConstraints([assertC, suggestC], makeOutput('text'), makeCtx(), async () => makeOutput('text')),
    ).rejects.toThrow(ConstraintViolationError)
  })
})

// ── runConstraints() — Retry budget ───────────────────────────────

describe('runConstraints — retry budget', () => {
  it('respects per-constraint maxRetries', async () => {
    let checkCount = 0

    const c = makeConstraint({
      name: 'limited',
      severity: 'assert',
      maxRetries: 2,
      check: async () => {
        checkCount++
        return { pass: false, feedback: 'Fail' }
      },
    })

    await expect(runConstraints([c], makeOutput('bad'), makeCtx(), async () => makeOutput('bad'))).rejects.toThrow(
      ConstraintViolationError,
    )

    // Initial check + 2 retries = 3 checks
    expect(checkCount).toBe(3)
  })

  it('respects shared constraintMaxRetries cap', async () => {
    let regenerateCount = 0

    const c = makeConstraint({
      name: 'greedy',
      severity: 'assert',
      maxRetries: 10, // wants many retries
      check: async () => ({ pass: false, feedback: 'Fail' }),
    })

    await expect(
      runConstraints(
        [c],
        makeOutput('bad'),
        makeCtx(),
        async () => {
          regenerateCount++
          return makeOutput('bad')
        },
        { constraintMaxRetries: 1 },
      ), // but capped at 1
    ).rejects.toThrow(ConstraintViolationError)

    expect(regenerateCount).toBe(1) // only 1 retry due to shared cap
  })
})

// ── runConstraints() — Audit trail ────────────────────────────────

describe('runConstraints — audit trail', () => {
  it('records entries for each check', async () => {
    const c = makeConstraint({
      name: 'audited',
      check: async () => ({ pass: true, metadata: { score: 0.95 } }),
    })

    const result = await runConstraints([c], makeOutput('text'), makeCtx(), async () => makeOutput(''))

    expect(result.audit.entries).toHaveLength(1)
    const entry = result.audit.entries[0]!
    expect(entry.constraint).toBe('audited')
    expect(entry.severity).toBe('assert')
    expect(entry.pass).toBe(true)
    expect(entry.durationMs).toBeGreaterThanOrEqual(0)
    expect(entry.metadata).toEqual({ score: 0.95 })
  })

  it('records feedback on failure', async () => {
    const c = makeConstraint({
      name: 'failing',
      severity: 'suggest',
      maxRetries: 0,
      check: async () => ({ pass: false, feedback: 'Missing citations' }),
    })

    const result = await runConstraints([c], makeOutput('text'), makeCtx(), async () => makeOutput(''))

    const entry = result.audit.entries[0]!
    expect(entry.pass).toBe(false)
    expect(entry.feedback).toBe('Missing citations')
  })

  it('fires onCheck callback', async () => {
    const checks: ConstraintAuditEntry[] = []

    const c = makeConstraint({
      name: 'observed',
      check: async () => ({ pass: true }),
    })

    await runConstraints([c], makeOutput('text'), makeCtx(), async () => makeOutput(''), {
      onCheck: (_c, entry) => checks.push(entry),
    })

    expect(checks).toHaveLength(1)
    expect(checks[0]!.constraint).toBe('observed')
  })

  it('fires onRetry callback with combined feedback', async () => {
    const retries: Array<{ attempt: number; feedbacks: readonly string[] }> = []

    const c = makeConstraint({
      name: 'retried',
      severity: 'assert',
      maxRetries: 1,
      check: async (output) => {
        if (output.text === 'bad') return { pass: false, feedback: 'Fix it' }
        return { pass: true }
      },
    })

    await runConstraints([c], makeOutput('bad'), makeCtx(), async () => makeOutput('good'), {
      onRetry: (_constraints, attempt, feedbacks) => retries.push({ attempt, feedbacks }),
    })

    expect(retries).toHaveLength(1)
    expect(retries[0]!.attempt).toBe(1)
  })
})

// ── evaluateConstraint() ──────────────────────────────────────────

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

    const result = await runConstraints([c], makeOutput('good'), makeCtx(), async () => makeOutput(''))
    expect(result.audit.entries[0]!.pass).toBe(true)
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
