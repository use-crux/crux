/**
 * Constraint authoring + evaluation tests.
 *
 * Execution semantics (parallel checks, combined-feedback retries, budgets,
 * assert/suggest separation, audits) are tested at the `Safety` session
 * boundary in `__tests__/safety/` — constraints only execute through the
 * session.
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { constraint as makeConstraint, isConstraint } from '../src/safety/constraint/define'
import { validateConstraintRunResult } from '../src/safety/constraint'
import { evaluateConstraint } from '../src/safety/constraint/evaluate'
import { ConstraintViolationError } from '../src/safety/constraint/errors'
import { boundary, SafetyResultError } from '../src/safety'
import { judge } from '../src/scoring'
import { citationSchema } from '../src/citations'
import type { RetrieverHit } from '../src/retrieval'
import type { BoundaryDef, SafetyRunContext, SubjectOf } from '../src/safety'
import type { Constraint, ConstraintContext } from '../src/safety/constraint/types'

const makeCtx = (overrides?: Partial<ConstraintContext>): ConstraintContext => ({
  promptId: 'test-prompt',
  model: 'test-model',
  traceId: undefined,
  attempt: 0,
  metadata: {},
  ...overrides,
})

function makeRunCtx<B extends BoundaryDef>(c: Constraint<B>): SafetyRunContext<B> {
  return {
    policy: { id: c.id, mode: 'enforce' },
    boundary: { id: c.on.id as never, kind: c.on.id as never },
    prompt: { id: 'test-prompt' },
    model: { id: 'test-model' },
    trace: {},
    attempt: { index: 0, kind: 'initial' },
    metadata: {},
    findings: { add() {} },
    ...(c.on.path ? { path: c.on.path } : {}),
  }
}

async function runConstraint<B extends BoundaryDef>(c: Constraint<B>, subject: SubjectOf<B>) {
  return c.run(subject, makeRunCtx(c))
}

function hit(overrides: Partial<RetrieverHit> = {}): RetrieverHit {
  return {
    namespace: 'docs',
    source: { id: 'guide.md' },
    chunkId: 'chunk-1',
    content: 'Hybrid search combines dense and sparse retrieval for better recall.',
    metadata: {},
    score: 0.9,
    ...overrides,
  }
}

// ── makeConstraint() ────────────────────────────────────────────

describe('constraint', () => {
  it('creates a frozen constraint object with correct shape', () => {
    const constraint = makeConstraint({
      id: 'test',
      on: boundary.output.both(),
      run: async () => ({ pass: true }),
    })

    expect(constraint._tag).toBe('Constraint')
    expect(constraint.id).toBe('test')
    expect(constraint.on.id).toBe('model.output')
    expect(constraint.severity).toBe('assert') // default
    expect(constraint.maxRetries).toBe(2) // default
    expect(constraint.onChunk).toBeUndefined()
    expect(Object.isFrozen(constraint)).toBe(true)
  })

  it('respects severity and maxRetries overrides', () => {
    const constraint = makeConstraint({
      id: 'soft',
      on: boundary.output.text(),
      severity: 'suggest',
      maxRetries: 5,
      run: async () => ({ pass: true }),
    })

    expect(constraint.severity).toBe('suggest')
    expect(constraint.maxRetries).toBe(5)
  })

  it('carries an optional risk category', () => {
    const constraint = makeConstraint({
      id: 'grounded',
      on: boundary.output.text(),
      category: 'grounding',
      run: async () => ({ pass: true }),
    })

    expect(constraint.category).toBe('grounding')
    expect(
      makeConstraint({ id: 'plain', on: boundary.output.text(), run: async () => ({ pass: true }) }).category,
    ).toBeUndefined()
  })
})

// ── isConstraint() ────────────────────────────────────────────────

describe('isConstraint', () => {
  it('returns true for constraint objects', () => {
    const constraint = makeConstraint({
      id: 'test',
      on: boundary.output.text(),
      run: async () => ({ pass: true }),
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
      id: 'citation-check',
      on: boundary.output.text(),
      run: async (output) => {
        if (output.includes('[1]')) return { pass: true }
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

  it('checks each item of an .items() constraint and fails on a later item', async () => {
    const seen: string[] = []
    const c = makeConstraint({
      id: 'short-items',
      on: boundary.output.object<{ items: readonly string[] }>().path('items').items(),
      run: async (item: string) => {
        seen.push(item)
        return item.length <= 3 ? { pass: true } : { pass: false, feedback: `too long: ${item}` }
      },
    })

    const report = await evaluateConstraint(c, [
      { input: { text: '', parsed: { items: ['ok', 'fine'] } }, expect: false },
      { input: { text: '', parsed: { items: ['a', 'bb'] } }, expect: true },
    ])

    expect(report.summary.passed).toBe(2) // both cases matched their expectation
    // The first case stopped at the failing item ('fine'); the second checked both.
    expect(seen).toEqual(['ok', 'fine', 'a', 'bb'])
  })

  it('resolves a scalar object path and is vacuously satisfied by a missing optional path', async () => {
    const scalar = makeConstraint({
      id: 'name-nonempty',
      on: boundary.output.object<{ account: { name: string } }>().path('account.name'),
      run: async (name: string) => (name.length > 0 ? { pass: true } : { pass: false, feedback: 'empty' }),
    })
    const optional = makeConstraint({
      id: 'note-optional',
      on: boundary.output.object<{ note?: string }>().path('note'),
      run: async () => ({ pass: false, feedback: 'should not run' }),
    })

    const scalarReport = await evaluateConstraint(scalar, [
      { input: { text: '', parsed: { account: { name: 'ok' } } }, expect: true },
      { input: { text: '', parsed: { account: { name: '' } } }, expect: false },
    ])
    const optionalReport = await evaluateConstraint(optional, [
      { input: { text: '', parsed: { present: 1 } }, expect: true }, // absent path → vacuous pass
    ])

    expect(scalarReport.summary.passed).toBe(2)
    expect(optionalReport.results[0]?.actualPass).toBe(true)
  })

  it('handles errors in check function', async () => {
    const c = makeConstraint({
      id: 'buggy',
      on: boundary.output.text(),
      run: async () => {
        throw new Error('Oops')
      },
    })

    const report = await evaluateConstraint(c, [{ input: { text: 'test' }, expect: true }])

    expect(report.results[0]!.matched).toBe(false)
    expect(report.results[0]!.error).toBe('Oops')
  })

  it('reports constraint metadata so tests can assert the runtime decision contract', async () => {
    const c = makeConstraint({
      id: 'risk-check',
      on: boundary.output.text(),
      run: async () => ({
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

describe('validateConstraintRunResult', () => {
  it('accepts pass/fail results with safe metadata', () => {
    expect(
      validateConstraintRunResult(
        { pass: true, metadata: { risk: 'none' } },
        { policyId: 'quality', boundary: 'model.output.text' },
      ),
    ).toEqual({ pass: true, metadata: { risk: 'none' } })

    expect(
      validateConstraintRunResult(
        { pass: false, feedback: 'Add citations.', metadata: { reason: 'missing-citation' } },
        { policyId: 'citations', boundary: 'model.output.object' },
      ),
    ).toEqual({
      pass: false,
      feedback: 'Add citations.',
      metadata: { reason: 'missing-citation' },
    })
  })

  it('fails closed when a failed result omits feedback', () => {
    expect(() =>
      validateConstraintRunResult(
        { pass: false },
        { policyId: 'malformed', boundary: 'model.output.text' },
      ),
    ).toThrow(SafetyResultError)
  })
})

describe('first-party constraint strategies', () => {
  it('adapts a judge into a retryable constraint strategy', async () => {
    const brandVoice = judge({
      id: 'brand-voice',
      criteria: 'Warm, direct, concrete.',
      scale: { min: 0, max: 10 },
      generate: async () => ({ object: { reasoning: 'Too vague.', score: 4 } }) as never,
      model: 'test-model',
    })
    const run = makeConstraint.judge({
      judge: brandVoice,
      minScore: 7,
      feedback: 'Rewrite with warmer, more concrete language.',
    })
    const c = makeConstraint({
      id: 'brand-voice',
      on: boundary.output.text(),
      run,
    })

    const result = await run('Generic copy.', makeCtx() as never)

    expect(c.strategy).toEqual({
      kind: 'constraint.judge',
      config: { judgeId: 'brand-voice', minScore: 7 },
    })
    expect(result).toMatchObject({
      pass: false,
      feedback: 'Rewrite with warmer, more concrete language.',
      metadata: {
        judge: {
          metricId: 'brand-voice',
          score: 4,
          minScore: 7,
          explanation: 'Too vague.',
        },
      },
    })
  })

  it('adapts citation validation into a constraint strategy', async () => {
    const schema = z.object({
      answer: z.string(),
      citations: z.array(citationSchema),
    })
    const run = makeConstraint.citations<typeof schema>({
      hits: [hit()],
      quotes: 'required',
    })
    const c = makeConstraint({
      id: 'grounded-citations',
      on: boundary.output.both<z.infer<typeof schema>>(),
      run,
    })

    const result = await run(
      {
        text: '',
        object: {
          answer: 'Hybrid search improves recall.',
          citations: [
            {
              sourceId: 'guide.md',
              chunkId: 'chunk-1',
              quote: 'dense and sparse retrieval',
            },
          ],
        },
      },
      makeCtx() as never,
    )

    expect(c.strategy).toEqual({
      kind: 'constraint.citations',
      config: { required: true, quotes: 'required' },
    })
    expect(result).toMatchObject({
      pass: true,
      metadata: {
        grounding: {
          summary: {
            citationCount: 1,
            validCitationCount: 1,
            invalidCitationCount: 0,
          },
        },
      },
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
    // Evidence only: a public terminal error carries size and hash for correlation,
    // never a preview of the rejected candidate.
    expect(err.lastOutput).toMatchObject({ level: 'safe', sizeBytes: 10 })
    expect(err.lastOutput.preview).toBeUndefined()
    expect(err.lastOutput.hash).toEqual(expect.any(String))
    expect(err.lastOutput.raw).toBeUndefined()
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
      id: 'typed',
      on: boundary.output.both(),
      run: async (output) => {
        if (output.text === 'bad') return { pass: false, feedback: 'Must provide feedback' }
        return { pass: true }
      },
    })

    const result = await runConstraint(c, { text: 'good', object: undefined })
    expect(result.pass).toBe(true)
  })
})
